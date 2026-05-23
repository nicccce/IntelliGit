> 本文为山东大学软件学院创新实训项目博客

# Go Sidecar Status 性能优化：把 Index 线性扫描改成一次 Map 查找

上一篇博客里，我记录了 IntelliGit Go Sidecar 在 `Repository` 层补并发锁的过程。

那次改动解决的是并发安全问题：主循环已经可以把多个请求放进 goroutine 里执行，但这些请求最后都会进入同一个 Git 仓库对象。如果没有统一的读写锁，`staging.status`、`diff.workdir`、`remote.fetch`、`branch.checkout` 这些操作就可能在 `.git` 目录、index、worktree 上互相交错。

这一次继续处理修复计划里的第 3 项：

```text
修改 sidecar/internal/git/staging.go
```

目标很明确：优化 `Status()` 里的 index 查找逻辑。

这次改动不是那种很大的架构重构，而是一个典型的“热路径数据结构替换”：原来代码在遍历每个文件状态时，都要重新扫描一遍 `idx.Entries`；现在改成先把 index entries 构造成 `map[string]*index.Entry`，后面按文件路径直接查表。

一句话概括就是：

```text
原来：每个文件都扫一遍 index
现在：index 只扫一遍，后面 O(1) 查询
```

看起来只是几行代码，但它刚好落在 `staging.status` 这个高频接口上。对于 Git 客户端来说，状态刷新几乎是用户打开项目后最常发生的操作之一，所以这里的每一点浪费都会被反复放大。

---

## 一、为什么 `staging.status` 是一个特别敏感的接口

IntelliGit 的变更视图依赖后端返回当前仓库的文件状态。前端需要知道哪些文件：

```text
已经暂存
还在工作区未暂存
是新增文件
是删除文件
是修改文件
```

这类信息最终都会通过 Sidecar 的 `staging.status` 命令拿到。对应到 Go 侧，就是：

```text
sidecar/internal/git/staging.go
```

里面的核心方法是：

```go
func (r *goGitBackend) Status() ([]FileStatus, error)
```

这个方法并不是一个低频工具函数。它会在很多场景下被调用：

```text
打开仓库后首次刷新
用户切换到 Changes 视图
用户执行 git add / restore / commit 后刷新
自动刷新定时器触发
外部编辑器修改文件后重新拉取状态
其他模块需要同步 selected file diff
```

也就是说，`Status()` 的性能不只影响一个按钮，而是影响整个变更工作台的“体感速度”。如果它在小仓库里慢 50ms，用户可能没感觉；但如果在大仓库里慢 1 秒、2 秒，界面就会明显发钝。

更关键的是，在前面的 Sidecar 并发化之后，`staging.status` 不再一定是排队等待的受害者，它也可能和其他请求同时跑起来。这个时候它自己是否足够轻，就变得更重要了。

---

## 二、原来的 `Status()` 里为什么会出现二次验证

`Status()` 并不是简单地调用一下 go-git 的 `wt.Status()` 就结束。它还有一段内容级二次验证逻辑。

先看大致流程：

```go
wt, err := r.repo.Worktree()
status, err := wt.Status()

headTree, _ := r.headTree()
idx, _ := r.repo.Storer.Index()

var result []FileStatus
for path, s := range status {
    // 对 Worktree Modified 做内容级验证
    // 对 Staging Modified 也做内容级验证
    result = append(result, FileStatus{...})
}
```

这里的二次验证主要是为了处理一些“状态看起来变了，但内容实际没有变”的情况。

比如换行符差异。Windows 上文件可能是 `\r\n`，而仓库里记录的是 `\n`。如果不做额外判断，就可能出现 go-git 认为文件是 Modified，但 IntelliGit 界面上显示了一个用户并不真正关心的“假修改”。

所以代码会把 reference 内容和当前内容都读出来，再做换行符规范化：

```go
refNormalized := strings.ReplaceAll(refContent, "\r\n", "\n")
wcNormalized := strings.ReplaceAll(wcContent, "\r\n", "\n")
if refNormalized == wcNormalized {
    continue
}
```

暂存区也有类似逻辑。它会比较 HEAD 里的旧内容和 index 里的新内容：

```go
headNormalized := strings.ReplaceAll(headContent, "\r\n", "\n")
indexNormalized := strings.ReplaceAll(indexContent, "\r\n", "\n")
if headNormalized == indexNormalized {
    continue
}
```

这套验证逻辑本身是有价值的。问题不在“要不要验证”，而在“验证时怎么找到 index 里的那个文件”。

---

## 三、真正的问题：每个文件都重新扫一遍 index

原来的代码在处理工作区 Modified 文件时，会优先从 index 里读取 reference 内容。逻辑大致是这样：

```go
var refContent string
if idx != nil {
    for _, entry := range idx.Entries {
        if entry.Name == path {
            if blob, bErr := r.repo.BlobObject(entry.Hash); bErr == nil {
                if reader, rErr := blob.Reader(); rErr == nil {
                    data, _ := io.ReadAll(reader)
                    reader.Close()
                    refContent = string(data)
                }
            }
            break
        }
    }
}
```

暂存区 Modified 的验证里也有一段几乎一样的逻辑：

```go
var indexContent string
if idx != nil {
    for _, entry := range idx.Entries {
        if entry.Name == path {
            if blob, bErr := r.repo.BlobObject(entry.Hash); bErr == nil {
                if reader, rErr := blob.Reader(); rErr == nil {
                    data, _ := io.ReadAll(reader)
                    reader.Close()
                    indexContent = string(data)
                }
            }
            break
        }
    }
}
```

这段代码的问题非常典型：**内层循环在外层循环里重复做线性查找。**

我们可以把它抽象成下面这样：

```text
for 每一个 status path:
  for 每一个 index entry:
    if entry.Name == path:
      找到了
```

假设当前仓库 index 里有 `n` 个条目，`status` 返回了 `k` 个需要二次验证的文件，那么这部分查找的复杂度就是：

```text
O(k * n)
```

如果是一个小仓库：

```text
n = 100
k = 5
```

最多几百次字符串比较，不明显。

但如果是一个中大型仓库：

```text
n = 20000
k = 500
```

这就可能变成千万级别的路径字符串比较。更麻烦的是，`staging.status` 不是一次性脚本，而是会被界面反复调用的高频请求。一次刷新浪费一点，自动刷新、用户操作刷新、diff 同步刷新叠起来，就会变成非常实在的卡顿。

这就是修复计划里把它标出来的原因：它属于典型的热路径 $O(n^2)$ 风险。

---

## 四、优化思路：把 index 先整理成查找表

这类问题最自然的解法就是：不要每次都去数组里找。

`idx.Entries` 是一组 index entry，每个 entry 都有文件路径：

```go
entry.Name
```

而我们后面查找时正好也是按 path 查：

```go
path
```

所以可以在进入 `status` 遍历之前，先构造一张表：

```go
map[string]*index.Entry
```

也就是：

```text
文件路径 -> index entry
```

这次实际加上的代码是：

```go
var indexMap map[string]*index.Entry
if idx != nil {
    indexMap = make(map[string]*index.Entry, len(idx.Entries))
    for _, entry := range idx.Entries {
        if _, exists := indexMap[entry.Name]; exists {
            continue
        }
        indexMap[entry.Name] = entry
    }
}
```

这段代码有几个细节。

第一个细节是 `idx != nil`。原来的逻辑只有在 index 存在时才扫描 `idx.Entries`，现在也保持一样。如果 index 不存在，`indexMap` 就是 nil map。Go 里对 nil map 做读取是安全的：

```go
entry, ok := indexMap[path]
```

它只会返回零值和 `false`，不会 panic。

第二个细节是容量：

```go
make(map[string]*index.Entry, len(idx.Entries))
```

既然已经知道 index entry 的数量，就顺手给 map 一个合理初始容量，减少扩容次数。这不是这次优化的核心，但属于顺手把数据结构用稳一点。

第三个细节是这段：

```go
if _, exists := indexMap[entry.Name]; exists {
    continue
}
```

原来的线性扫描逻辑是遇到第一个同名 entry 后就 `break`。如果我们直接写：

```go
indexMap[entry.Name] = entry
```

那么遇到同名 entry 时，后面的 entry 会覆盖前面的 entry。正常仓库里同一路径通常只会有一个 index entry，但 Git index 在冲突等特殊状态下可能出现更复杂的阶段信息。为了让这次优化尽量只改变性能、不改变语义，我选择保留旧逻辑的“第一个匹配项”行为。

这也是做性能优化时很重要的一点：**换数据结构时，不要顺手改业务语义。**

---

## 五、第一处替换：工作区 Modified 的 reference 查找

原来的工作区验证逻辑需要从 index 里找当前 `path` 对应的 entry。改完以后，不再扫描 `idx.Entries`，而是直接查 `indexMap`：

```go
var refContent string
if entry, ok := indexMap[path]; ok {
    if blob, bErr := r.repo.BlobObject(entry.Hash); bErr == nil {
        if reader, rErr := blob.Reader(); rErr == nil {
            data, _ := io.ReadAll(reader)
            reader.Close()
            refContent = string(data)
        }
    }
}
if refContent == "" && headTree != nil {
    if f, fErr := headTree.File(path); fErr == nil {
        refContent, _ = f.Contents()
    }
}
```

这段逻辑的行为没有变：

```text
优先从 index 取 reference 内容
如果 index 没取到，再 fallback 到 HEAD tree
再和工作区内容做换行符规范化比较
```

变化只在查找路径上：

```text
for _, entry := range idx.Entries
```

变成：

```text
indexMap[path]
```

也就是说，原来每处理一个 modified 文件，都要从 index 第一个 entry 开始找；现在每个文件只做一次 hash lookup。

---

## 六、第二处替换：暂存区 Modified 的 index 内容查找

暂存区 Modified 的二次验证也有同样的问题。

它要比较：

```text
HEAD 版本内容
index 版本内容
```

HEAD 内容还是从 `headTree.File(path)` 拿：

```go
var headContent string
if headTree != nil {
    if f, fErr := headTree.File(path); fErr == nil {
        headContent, _ = f.Contents()
    }
}
```

index 内容则改成直接从 `indexMap` 查：

```go
var indexContent string
if entry, ok := indexMap[path]; ok {
    if blob, bErr := r.repo.BlobObject(entry.Hash); bErr == nil {
        if reader, rErr := blob.Reader(); rErr == nil {
            data, _ := io.ReadAll(reader)
            reader.Close()
            indexContent = string(data)
        }
    }
}
```

然后继续保持原来的规范化比较：

```go
headNormalized := strings.ReplaceAll(headContent, "\r\n", "\n")
indexNormalized := strings.ReplaceAll(indexContent, "\r\n", "\n")
if headNormalized == indexNormalized {
    continue
}
```

这样，`Status()` 里的两处重复线性扫描都消掉了。

改完以后，整体查找模型从：

```text
for 每一个 status path:
  扫一遍 index entries
```

变成：

```text
先扫一遍 index entries，建立 map

for 每一个 status path:
  O(1) 查 map
```

复杂度也就从：

```text
O(k * n)
```

变成：

```text
O(n + k)
```

这就是这次修复最核心的收益。

---

## 七、为什么这次只改 `staging.go`，没有顺手改 `diff.go`

修复计划里第 4 项还提到了：

```text
sidecar/internal/git/diff.go
```

那里也存在类似的 index 查找问题。`DiffWorkdir()` 和 `DiffStaged()` 在取 index 内容时，也能看到 `for _, entry := range idx.Entries` 这样的线性扫描。

这次我没有把它一起改掉，原因不是看不到，而是为了保持任务边界清楚。

当前用户要求的是：

```text
完成 repair-plan.md 的 3. 修改 sidecar/internal/git/staging.go 任务
```

所以这次提交只处理 `staging.go`，不把 `diff.go` 的第 4 项混进来。这样有几个好处：

```text
改动范围清晰
验证目标明确
回归风险更小
后续第 4 项可以单独写、单独测、单独记录
```

尤其是 `diff.go` 的逻辑和 `staging.go` 不完全一样。Diff 里会涉及工作区内容、HEAD 内容、index 内容、删除文件、未追踪文件、patch 构造等更多分支。虽然优化方向类似，但最好还是单独处理。

这次先把 `staging.status` 这条高频路径的明显问题解决掉。

---

## 八、改动后的完整关键片段

最终 `Status()` 里和 index 查找相关的关键代码变成了这样：

```go
// 预先获取 HEAD tree 和 index，用于内容级二次验证
headTree, _ := r.headTree()
idx, _ := r.repo.Storer.Index()
var indexMap map[string]*index.Entry
if idx != nil {
    indexMap = make(map[string]*index.Entry, len(idx.Entries))
    for _, entry := range idx.Entries {
        if _, exists := indexMap[entry.Name]; exists {
            continue
        }
        indexMap[entry.Name] = entry
    }
}

var result []FileStatus
for path, s := range status {
    if s.Worktree == gogit.Modified {
        var refContent string
        if entry, ok := indexMap[path]; ok {
            if blob, bErr := r.repo.BlobObject(entry.Hash); bErr == nil {
                if reader, rErr := blob.Reader(); rErr == nil {
                    data, _ := io.ReadAll(reader)
                    reader.Close()
                    refContent = string(data)
                }
            }
        }

        // 后续逻辑保持不变
    }

    if s.Staging == gogit.Modified {
        var indexContent string
        if entry, ok := indexMap[path]; ok {
            if blob, bErr := r.repo.BlobObject(entry.Hash); bErr == nil {
                if reader, rErr := blob.Reader(); rErr == nil {
                    data, _ := io.ReadAll(reader)
                    reader.Close()
                    indexContent = string(data)
                }
            }
        }

        // 后续逻辑保持不变
    }
}
```

这段代码的特点是很朴素：

```text
没有引入新的抽象
没有改变返回结构
没有改变排序逻辑
没有改变换行符规范化逻辑
没有改变 HEAD fallback 逻辑
```

它只是把“按路径找 index entry”这件事从重复线性扫描，换成了一次性预处理后的 map 查询。

这种改动在代码审查时也比较容易确认正确性，因为业务分支几乎没有被重排。

---

## 九、验证过程

改完以后，我先对 `staging.go` 做了格式化：

```powershell
gofmt -w sidecar/internal/git/staging.go
```

然后先跑了 Git 包级测试：

```powershell
go test ./internal/git
```

通过后，再跑整个 Sidecar 的 Go 测试：

```powershell
go test ./...
```

结果是：

```text
?    intelligit-sidecar/cmd/sidecar      [no test files]
ok   intelligit-sidecar/internal/git
ok   intelligit-sidecar/internal/handler
?    intelligit-sidecar/internal/protocol [no test files]
```

测试时本机默认 Go build cache 目录有权限限制，所以我临时把 `GOCACHE` 指到了工作区内：

```powershell
$env:GOCACHE='E:\IntelliGit\.gocache'
go test ./...
```

测试结束后，这个临时缓存目录也已经清理掉了。

---

## 十、这次优化的意义

这次改动本身不大，但它很符合 IntelliGit 这类桌面 Git 客户端的性能优化方向。

Git 客户端和普通业务系统不太一样。它经常要面对非常不均匀的输入规模：

```text
有的仓库只有几十个文件
有的仓库有几万个文件
有的用户一次只改一个文件
有的用户一次 rebase / merge 后会出现几百个变更
```

如果热路径里藏着一个重复线性扫描，小仓库可能永远暴露不出来；但一到大仓库，它就会突然变成用户能感知到的卡顿。

`Status()` 正是这样的热路径。它承担的是“告诉界面当前仓库发生了什么”的职责。只要这个接口变慢，Changes 视图、暂存操作、提交前状态刷新、diff 同步都会跟着变慢。

所以这次优化的价值不只是少做了几次循环，而是把状态刷新链路里的一个不必要放大器拿掉了：

```text
index entries 越多
modified files 越多
旧逻辑浪费越明显
```

现在它变成：

```text
index entries 扫一次
modified files 各查一次 map
```

这是一种更稳定的增长方式。

---

## 十一、后续可以继续做什么

这次只完成了修复计划第 3 项，也就是 `staging.go` 的 index map 优化。

后续还可以继续处理两个方向。

第一个方向是 `diff.go`。那里也存在类似的 `idx.Entries` 线性查找，可以用同样的思路构建 index map，减少单文件 diff 请求里的重复扫描。

第二个方向是更进一步减少全局 `wt.Status()` 的调用。现在很多 diff 或状态相关逻辑仍然会先拿全量 status，再从里面找单个文件。如果未来要继续优化大仓库体验，可以考虑为单文件 diff 和单文件状态设计更窄的读取路径。

不过这一步先把最明确、最局部、收益也很直接的部分落掉：

```text
sidecar/internal/git/staging.go
  -> Status()
  -> idx.Entries 线性扫描
  -> indexMap O(1) 查找
```

这类优化没有太多戏剧性，但很实在。它就像把一条每天都要走很多次的路上，那段没必要绕远的弯给抹平了。用户不一定知道这里发生了什么，但界面会少等一点，状态刷新会轻一点，后续继续优化时也会更有底气。
