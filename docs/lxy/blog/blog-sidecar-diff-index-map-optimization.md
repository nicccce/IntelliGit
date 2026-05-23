> 本文为山东大学软件学院创新实训项目博客

# Go Sidecar Diff 性能优化：让 DiffWorkdir 和 DiffStaged 复用 Index Map

上一篇博客里，我记录了 `sidecar/internal/git/staging.go` 的一次性能优化。

那次改动的核心是把 `Status()` 里的 index 线性扫描改成一次性构建 `map[string]*index.Entry`。原来每处理一个文件状态，都要重新遍历一遍 `idx.Entries`；改完以后，index entries 只扫描一次，后续按文件路径直接查表。

这次继续完成修复计划里的第 4 项：

```text
修改 sidecar/internal/git/diff.go
```

这一步和上一篇文章的思路一脉相承。`diff.go` 里也有两处类似问题：

```text
DiffWorkdir()
DiffStaged()
```

它们在生成结构化 diff 时，也需要根据文件路径从 Git index 中找到对应的 entry。原来的实现是在遍历 status 文件时，对每个文件都重新扫描一遍 `idx.Entries`。这在小仓库里不明显，但在大仓库、多变更文件、频繁刷新 diff 的场景下，会把一次 diff 请求放大成很多不必要的路径比较。

这次改动的目标很明确：

```text
在 diff.go 中构建一次 indexMap
让 DiffWorkdir 和 DiffStaged 都通过 map 查找 index entry
避免每个文件重复线性扫描 index
```

---

## 一、为什么 diff 接口也需要关注性能

在 IntelliGit 里，diff 不是一个低频能力。

用户在 Changes 视图里点击文件时，前端会请求当前文件的 diff；用户执行暂存、取消暂存、丢弃修改、提交后，界面也会同步刷新 diff。除此之外，前端还有 selected file diff 的同步逻辑，用来保证当前选中文件的展示内容和仓库状态一致。

也就是说，diff 接口会出现在很多交互链路中：

```text
打开仓库后选择第一个变更文件
切换 Changes 文件列表中的选中项
git add 后刷新当前文件 diff
git restore 后刷新当前文件 diff
commit 成功后清理或刷新 diff
外部编辑器修改文件后重新同步 diff
```

这类请求不像 `remote.fetch` 那样天然耗时很长，但它对体感非常敏感。用户点击一个文件后，右侧 diff 面板应该尽快出现内容。如果这里有重复扫描、重复读取、重复构造，就会让界面显得迟钝。

本次目标文件是：

```text
sidecar/internal/git/diff.go
```

里面和本次相关的两个方法是：

```go
func (r *goGitBackend) DiffWorkdir(filePath string) (*PatchDetail, error)
func (r *goGitBackend) DiffStaged(filePath string) (*PatchDetail, error)
```

前者对应工作区未暂存 diff，语义接近：

```text
git diff
```

后者对应暂存区 diff，语义接近：

```text
git diff --cached
```

它们返回的不是原始 patch 字符串，而是 IntelliGit 前端可以直接渲染的结构化数据：

```go
type PatchDetail struct {
    FilePatches []FilePatchInfo
}
```

也就是说，这里既要读 Git 状态，也要读文件内容，还要把 old/new 内容转成行级 diff chunks。任何多余的循环都会叠加到最终响应时间上。

---

## 二、DiffWorkdir 原来的查找方式

先看 `DiffWorkdir()` 的职责。

它要生成工作区未暂存变更的 diff。大致流程是：

```text
1. 获取 worktree
2. 获取 status
3. 获取 HEAD tree 作为 fallback 基准
4. 获取 index
5. 遍历 status 中的文件
6. 为每个文件准备 oldContent 和 newContent
7. 调用 buildFilePatch 生成结构化 patch
```

其中最关键的是 oldContent 和 newContent。

对于工作区 diff 来说：

```text
oldContent：优先来自 index，拿不到时 fallback 到 HEAD
newContent：来自工作区文件系统
```

原来的 oldContent 查找逻辑大致是这样：

```go
var oldContent string
for _, entry := range idx.Entries {
    if entry.Name == path {
        blob, bErr := r.repo.BlobObject(entry.Hash)
        if bErr == nil {
            reader, rErr := blob.Reader()
            if rErr == nil {
                data, _ := io.ReadAll(reader)
                reader.Close()
                oldContent = string(data)
            }
        }
        break
    }
}
if oldContent == "" {
    if headTree != nil {
        f, fErr := headTree.File(path)
        if fErr == nil {
            oldContent, _ = f.Contents()
        }
    }
}
```

这段逻辑在语义上没有问题。它表达的是：

```text
如果 index 中有这个文件，就用 index 版本作为工作区 diff 的旧内容。
如果 index 中没有，再尝试从 HEAD tree 中取。
```

问题在于查找方式。

`DiffWorkdir()` 外面已经在遍历 status：

```go
for path, fileStatus := range status {
    ...
}
```

而每进入一个文件，又会遍历一遍 index：

```go
for _, entry := range idx.Entries {
    if entry.Name == path {
        ...
    }
}
```

抽象一下就是：

```text
for 每个 status path:
  for 每个 index entry:
    如果 entry.Name == path，就读取 blob
```

如果 index 里有 `n` 个文件，status 里有 `k` 个需要处理的文件，这里的路径查找复杂度就是：

```text
O(k * n)
```

对于一个几百个文件的小仓库，这可能没什么感觉。但对于几万个文件的大仓库，哪怕用户只关心几个变更文件，也可能因为每次查找都从 index 头部扫起而浪费大量字符串比较。

---

## 三、DiffStaged 也有同样的问题

`DiffStaged()` 的逻辑和 `DiffWorkdir()` 不完全一样，但它也需要从 index 里拿内容。

暂存区 diff 的语义接近：

```text
git diff --cached
```

所以它要比较的是：

```text
oldContent：HEAD 中的文件内容
newContent：index 中的文件内容
```

原来的 newContent 查找逻辑是这样：

```go
newContent := ""
if fileStatus.Staging != gogit.Deleted {
    for _, entry := range idx.Entries {
        if entry.Name == path {
            blob, bErr := r.repo.BlobObject(entry.Hash)
            if bErr == nil {
                reader, rErr := blob.Reader()
                if rErr == nil {
                    data, _ := io.ReadAll(reader)
                    reader.Close()
                    newContent = string(data)
                }
            }
            break
        }
    }
}
```

这里同样是在 status 遍历里面嵌套 index 遍历。

暂存区变更在某些场景下可能很多，比如：

```text
用户一次 git add -A
用户解决 merge conflict 后暂存多个文件
用户导入或生成大量文件
用户切换分支后产生较大规模差异
```

在这些场景里，`DiffStaged()` 如果要返回所有暂存文件的结构化 diff，就会对每个 staged path 都重复扫描 index。

即使前端更多时候只请求单文件 diff，这个问题也仍然值得修。原因有两个：

第一，`filePath` 为空时这个接口支持返回所有文件的 diff，后端能力本身不能只按单文件场景优化。

第二，代码里相同的数据结构问题已经在 `staging.go` 中出现过一次。既然 `diff.go` 使用的是同一类 index 查找，就应该统一修掉，避免后续维护时出现两个文件两套性能特征。

---

## 四、优化思路：在 diff.go 中抽一个 buildIndexMap

这次没有在 `DiffWorkdir()` 和 `DiffStaged()` 里各写一遍建 map 代码，而是在 `diff.go` 内部抽了一个小函数：

```go
func buildIndexMap(idx *index.Index) map[string]*index.Entry {
    if idx == nil {
        return nil
    }

    indexMap := make(map[string]*index.Entry, len(idx.Entries))
    for _, entry := range idx.Entries {
        if _, exists := indexMap[entry.Name]; exists {
            continue
        }
        indexMap[entry.Name] = entry
    }
    return indexMap
}
```

为了使用 `index.Index` 和 `index.Entry` 类型，`diff.go` 新增了 import：

```go
import (
    ...
    "github.com/go-git/go-git/v5/plumbing/format/index"
    ...
)
```

这个 helper 的语义很简单：

```text
输入：go-git 读出来的 index
输出：文件路径到 index entry 的查找表
```

这里有几个细节。

第一个细节是 `idx == nil` 时直接返回 nil：

```go
if idx == nil {
    return nil
}
```

Go 允许从 nil map 中读取：

```go
entry, ok := indexMap[path]
```

这不会 panic，只会得到 `ok == false`。所以调用方不需要额外写很多判空分支。

第二个细节是 map 初始容量：

```go
make(map[string]*index.Entry, len(idx.Entries))
```

index entry 数量已经知道，提前给容量可以减少扩容。这个收益不是核心，但属于顺手把数据结构用得更稳。

第三个细节是保留“第一个匹配项”的语义：

```go
if _, exists := indexMap[entry.Name]; exists {
    continue
}
```

原来的线性扫描遇到第一个同名 entry 后会 `break`。如果 map 构建时直接覆盖，那么同名 entry 会变成最后一个生效。正常情况下同一路径通常只有一个 index entry，但在冲突等特殊状态下，Git index 可能存在更复杂的 stage 信息。

为了让本次优化只改变性能，不顺手改变语义，所以这里选择保留旧逻辑的“第一个匹配项”行为。

---

## 五、DiffWorkdir 的实际改动

`DiffWorkdir()` 里原来获取 index 后直接进入 status 遍历：

```go
idx, err := r.repo.Storer.Index()
if err != nil {
    return nil, fmt.Errorf("获取 index 失败: %w", err)
}

detail := &PatchDetail{FilePatches: make([]FilePatchInfo, 0)}

for path, fileStatus := range status {
    ...
}
```

现在在进入循环前多了一步：

```go
idx, err := r.repo.Storer.Index()
if err != nil {
    return nil, fmt.Errorf("获取 index 失败: %w", err)
}
indexMap := buildIndexMap(idx)
```

然后 oldContent 的查找从线性扫描改成 map 查询：

```go
var oldContent string
if entry, ok := indexMap[path]; ok {
    blob, bErr := r.repo.BlobObject(entry.Hash)
    if bErr == nil {
        reader, rErr := blob.Reader()
        if rErr == nil {
            data, _ := io.ReadAll(reader)
            reader.Close()
            oldContent = string(data)
        }
    }
}
if oldContent == "" {
    if headTree != nil {
        f, fErr := headTree.File(path)
        if fErr == nil {
            oldContent, _ = f.Contents()
        }
    }
}
```

这里最重要的是业务行为没有变化：

```text
仍然优先读取 index blob
仍然在 index 内容为空时 fallback 到 HEAD tree
仍然用工作区文件作为 newContent
仍然通过 buildFilePatch 生成结构化 chunks
仍然通过 isRealChange 过滤无真实变化的 patch
```

变化只有一个：

```text
找 index entry 的方式从重复遍历变成 map 查找
```

这就是一次比较干净的局部性能优化。

---

## 六、DiffStaged 的实际改动

`DiffStaged()` 也在获取 index 后构建同一个 map：

```go
idx, err := r.repo.Storer.Index()
if err != nil {
    return nil, fmt.Errorf("获取 index 失败: %w", err)
}
indexMap := buildIndexMap(idx)
```

然后暂存区 newContent 的查找改成：

```go
newContent := ""
if fileStatus.Staging != gogit.Deleted {
    if entry, ok := indexMap[path]; ok {
        blob, bErr := r.repo.BlobObject(entry.Hash)
        if bErr == nil {
            reader, rErr := blob.Reader()
            if rErr == nil {
                data, _ := io.ReadAll(reader)
                reader.Close()
                newContent = string(data)
            }
        }
    }
}
```

这里仍然保留了删除文件的判断：

```go
if fileStatus.Staging != gogit.Deleted
```

因为对于 staged delete 来说，newContent 本来就应该是空的。此时不需要从 index 里读 blob。

HEAD 内容的读取也没有变化：

```go
var oldContent string
if headTree != nil {
    f, fErr := headTree.File(path)
    if fErr == nil {
        oldContent, _ = f.Contents()
    }
}
```

所以 `DiffStaged()` 的语义仍然是：

```text
HEAD 内容作为旧版本
index 内容作为新版本
如果 staged delete，则新版本为空
最后构造结构化 patch
```

只是 index 内容的定位方式更直接了。

---

## 七、复杂度从 O(k * n) 变成 O(n + k)

这次改动最直接的收益体现在复杂度上。

原来的模型是：

```text
for 每一个需要生成 diff 的文件:
  扫描一遍 idx.Entries
```

复杂度是：

```text
O(k * n)
```

其中：

```text
k = status 中需要处理的文件数
n = index entries 数量
```

改完以后模型变成：

```text
先扫描一遍 idx.Entries，构建 indexMap

for 每一个需要生成 diff 的文件:
  通过 indexMap[path] 查找 entry
```

复杂度变成：

```text
O(n + k)
```

这类优化在小仓库里看起来并不惊艳，但它的意义是让接口面对大仓库时增长得更稳定。

举个简单例子：

```text
index entries: 30000
需要 diff 的文件: 300
```

旧逻辑最坏情况下可能产生接近：

```text
300 * 30000 = 9000000
```

次路径比较。

新逻辑是：

```text
30000 + 300
```

次主要查找步骤。

虽然真实耗时还会受到 blob 读取、文件系统读取、diff 算法本身影响，但这种重复 index 扫描本来就是不必要的。把它拿掉，至少可以保证 diff 请求不会因为 index 查找这一环被无谓放大。

---

## 八、为什么这次没有顺手改 Myers Diff 算法

修复计划后面还提到了 `diff.go` 里的另一个性能点：

```text
myersDiff
```

当前 `myersDiff()` 的实现会在搜索过程中保存路径，并在每一步做 `make` 和 `copy`。这种写法比较直观，但在差异较大时可能制造较多内存分配和 GC 压力。

这次我没有把 Myers Diff 一起重写，原因是任务边界不同。

本次要完成的是修复计划第 4 项：

```text
修改 sidecar/internal/git/diff.go
目标：复用 staging.go 中的 indexMap 思路，优化 DiffWorkdir 和 DiffStaged 的 index 查找
```

而 Myers Diff 属于第 7 项，是另一个更深的算法层优化。它不仅影响性能，还可能影响 chunk 生成结果、Add/Delete/Equal 的顺序、前端 diff 渲染细节。那类改动需要更多测试样例，不适合混在这次 index map 优化里。

所以这次保持克制：

```text
只改 index entry 查找方式
不改 patch 构造逻辑
不改 diffLines
不改 myersDiff
不改 editsToChunks
不改前端数据结构
```

这样改动范围清楚，验证也更直接。

---

## 九、这次改动和 staging.go 优化的关系

这次 `diff.go` 的改动和上一篇 `staging.go` 的改动非常相似，但它们作用的位置不同。

`staging.go` 优化的是：

```text
Status()
  -> 对 modified 文件做内容级二次验证
  -> 通过 indexMap 找 reference/index 内容
```

`diff.go` 优化的是：

```text
DiffWorkdir()
  -> 构造工作区 diff
  -> 通过 indexMap 找 oldContent

DiffStaged()
  -> 构造暂存区 diff
  -> 通过 indexMap 找 newContent
```

也就是说，上一篇文章解决的是“状态列表刷新”里的重复扫描；这篇文章解决的是“diff 内容生成”里的重复扫描。

这两个接口经常会一起出现在同一条用户交互链路里：

```text
用户保存文件
  -> 前端刷新 status
  -> 发现 selected file 仍然存在变更
  -> 同步 selected file diff
```

如果只优化 `Status()`，状态列表会轻一点，但 diff 同步仍然可能重复扫 index。现在两个环节都用了同样的 index map 思路，这条链路就更一致了。

---

## 十、实际修改的代码位置

本次实际修改文件只有一个：

```text
sidecar/internal/git/diff.go
```

主要改动包括：

```text
1. 新增 github.com/go-git/go-git/v5/plumbing/format/index import。
2. 在 DiffWorkdir() 获取 index 后构建 indexMap。
3. 将 DiffWorkdir() 中 oldContent 的 idx.Entries 线性扫描改为 indexMap[path]。
4. 在 DiffStaged() 获取 index 后构建 indexMap。
5. 将 DiffStaged() 中 newContent 的 idx.Entries 线性扫描改为 indexMap[path]。
6. 新增 buildIndexMap(idx *index.Index) map[string]*index.Entry helper。
```

其中 `DiffWorkdir()` 的关键变化是：

```go
indexMap := buildIndexMap(idx)

...

var oldContent string
if entry, ok := indexMap[path]; ok {
    blob, bErr := r.repo.BlobObject(entry.Hash)
    if bErr == nil {
        reader, rErr := blob.Reader()
        if rErr == nil {
            data, _ := io.ReadAll(reader)
            reader.Close()
            oldContent = string(data)
        }
    }
}
```

`DiffStaged()` 的关键变化是：

```go
indexMap := buildIndexMap(idx)

...

newContent := ""
if fileStatus.Staging != gogit.Deleted {
    if entry, ok := indexMap[path]; ok {
        blob, bErr := r.repo.BlobObject(entry.Hash)
        if bErr == nil {
            reader, rErr := blob.Reader()
            if rErr == nil {
                data, _ := io.ReadAll(reader)
                reader.Close()
                newContent = string(data)
            }
        }
    }
}
```

新增的 helper 是：

```go
func buildIndexMap(idx *index.Index) map[string]*index.Entry {
    if idx == nil {
        return nil
    }

    indexMap := make(map[string]*index.Entry, len(idx.Entries))
    for _, entry := range idx.Entries {
        if _, exists := indexMap[entry.Name]; exists {
            continue
        }
        indexMap[entry.Name] = entry
    }
    return indexMap
}
```

这段 helper 目前放在 `diff.go` 内部，是一个文件内私有函数。原因是当前它只服务于 diff 生成逻辑。虽然 `staging.go` 里也有类似代码，但这次没有马上把它抽到更公共的位置。

主要考虑是：公共抽象应该在重复形态稳定后再提取。现在两个文件里的用法虽然相似，但它们处理错误、fallback、内容读取的上下文不同。先保持局部清晰，比过早抽一个跨文件 helper 更稳。

---

## 十一、验证过程

改完代码后，先执行了 Go 格式化：

```powershell
gofmt -w sidecar/internal/git/diff.go
```

然后运行 Sidecar 测试：

```powershell
cd sidecar
go test ./...
```

第一次在默认沙箱内运行时，Go 构建缓存目录被当前环境拦住：

```text
pattern ./...: open C:\Users\pc23\AppData\Local\go-build\...\*.d: Access is denied.
```

这不是代码错误，而是测试过程需要写入用户目录下的 Go build cache。按规则提升权限后重新运行，测试通过：

```text
?    intelligit-sidecar/cmd/sidecar       [no test files]
ok   intelligit-sidecar/internal/git      13.504s
ok   intelligit-sidecar/internal/handler  4.468s
?    intelligit-sidecar/internal/protocol [no test files]
```

这说明本次 `diff.go` 的改动没有破坏现有 Git 层和 handler 层测试。

---

## 十二、这次优化的意义

这次改动从代码量看不大，但它属于很典型的后端热路径优化。

IntelliGit 是桌面 Git 客户端，很多操作都会围绕当前仓库状态展开。状态和 diff 又是 Changes 视图里最核心的两个数据来源：

```text
Status 决定左侧文件列表显示什么
Diff 决定右侧内容面板显示什么
```

上一篇优化了 status，这一篇优化了 diff。两者合起来，就是把 Changes 视图里最常走的两条后端路径都清理了一遍。

本次优化没有改变任何前端 API，也没有改变结构化 diff 的返回格式。它只是让 `DiffWorkdir()` 和 `DiffStaged()` 在读 index 时不再重复做线性查找。

最终模型从：

```text
每个文件都重新扫描 index
```

变成：

```text
index 扫描一次
后续按 path 查 map
```

这种优化的好处是很稳定。仓库越大、index entries 越多、一次需要处理的 diff 文件越多，它节省的重复工作就越明显。

更重要的是，它让 `diff.go` 和 `staging.go` 在同一类问题上形成了一致写法。后续如果继续做更深层的 diff 性能优化，比如重写 `myersDiff()` 的路径记录方式，就可以在一个更干净的基础上继续推进。

---

## 十三、总结

这次完成的是修复计划第 4 项：优化 `sidecar/internal/git/diff.go`。

最终改动可以概括为：

```text
DiffWorkdir:
  旧逻辑：为每个文件遍历 idx.Entries 找 oldContent
  新逻辑：先 buildIndexMap，再通过 indexMap[path] 找 oldContent

DiffStaged:
  旧逻辑：为每个文件遍历 idx.Entries 找 newContent
  新逻辑：先 buildIndexMap，再通过 indexMap[path] 找 newContent

复杂度:
  从 O(k * n) 降到 O(n + k)
```

这不是一次看起来很炫的改动，但它解决的是一个真实存在的重复工作。对于 Git 客户端来说，这类局部优化很重要，因为用户不会只调用一次 status 或 diff。它们会随着每次保存、每次点击、每次暂存和每次刷新反复出现。

把这些热路径上的多余循环拿掉，IntelliGit 在大仓库里的表现就会更稳一点。也正是这些看起来朴素的修补，最终会累积成一个更顺、更可靠的桌面 Git 工具。
