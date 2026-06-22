> 本文为山东大学软件学院创新实训项目博客

# IntelliGit 智能分组暂存新增文件问题修复

这次修的是 IntelliGit 提交工作区里一个比较隐蔽，但实际使用时很容易碰到的问题：智能分组暂存遇到“全部都是新增文件”的场景时，用户必须先手动把文件全部放进暂存区，系统才能分析出分组。

这个行为显然不符合智能分组暂存的设计目标。

理想流程应该是：

```text
工作区存在若干变更
点击智能分组分析
系统基于当前所有变更给出提交意图分组
用户选择某个分组
点击 √
系统清理当前暂存区
只把选中的分组放入暂存区
再基于该分组生成提交信息
```

也就是说，分析动作不应该要求用户先暂存。暂存应该发生在用户明确选择某个建议分组之后。

这篇博客记录一下这次问题是怎么定位的，以及最后为什么需要同时改 Sidecar 的 raw diff 能力和 Renderer 的智能提交 workflow。

---

## 一、问题表象：新增文件不先暂存就无法分析

最开始看到的现象很直接。

如果工作区里是普通修改文件，比如：

```text
M src/foo.ts
M src/bar.ts
```

点击智能分组按钮，系统可以正常读取 diff，然后进入 AI 分组或者本地 fallback 分组流程。

但是如果工作区里全是新增文件，而且这些文件还没有进入暂存区，比如：

```text
?? src/new-feature.ts
?? src/new-helper.ts
```

这个时候点击智能分组，系统会提示当前没有可分析的代码变更。

用户如果先手动执行“全部暂存”，再点击智能分组，分析又能正常工作。

这说明问题并不是 AI 分组本身坏了，也不是提交面板没有拿到文件状态。真正的问题更像是：分析流程读取 diff 的方式看不到未跟踪文件。

---

## 二、为什么普通修改能分析，新增文件却不行

智能分组入口在 Renderer 里：

```text
src/renderer/src/services/smartCommitService.ts
```

分析函数会同时读取两个 raw diff：

```ts
const [workdirDiff, stagedDiff] = await Promise.all([
  invokeGit('diff.workdirRaw', {}),
  invokeGit('diff.stagedRaw', {})
])
```

旧逻辑会在两者之间选一个：

```ts
const diff = workdirDiff.diff || stagedDiff.diff
```

表面上看，这已经考虑了工作区和暂存区两种来源。但问题在于，`diff.workdirRaw` 的后端实现本质上调用的是：

```bash
git diff
```

而 Git 的默认行为是：`git diff` 只展示已跟踪文件的工作区修改，不展示 untracked 文件。

所以当工作区里只有未跟踪新增文件时：

```bash
git diff
```

输出是空的。

如果暂存区也为空：

```bash
git diff --staged
```

输出同样是空的。

最后 Renderer 得到的 `diff` 就是空字符串，于是智能分组流程只能认为“当前没有可分析的变更”。

这也解释了为什么用户手动全部暂存之后又能分析。因为新增文件进入 index 后，`git diff --staged` 就可以看到这些新增文件的 patch 了。

---

## 三、真正要修的不是按钮，而是 diff 能力

这个问题如果只从前端按钮入手，很容易做出一个看似能跑、但语义不对的方案。

比如在点击“分析分组”前自动执行：

```text
staging.addAll
```

这样确实能让新增文件进入 staged diff，也就能分析了。但这会把“分析”动作变成一个会修改暂存区的动作。

这和产品逻辑是冲突的。

分析应该是只读的。用户只是想看看系统建议怎么分组，不代表他已经决定要把所有文件放进暂存区。

所以正确的修复方向不是“分析前自动暂存”，而是让工作区 raw diff 本身能够表达未跟踪新增文件。

换句话说，`diff.workdirRaw` 需要具备这样的能力：

```text
已跟踪文件修改 -> 来自 git diff
未跟踪新增文件 -> 额外合成 new file patch
```

这样分析阶段就可以读取完整工作区 diff，但不会修改真实暂存区。

---

## 四、Sidecar 层补齐 untracked 文件的 raw diff

后端相关代码在：

```text
sidecar/internal/git/staging_hunk.go
```

原来的 `DiffWorkdirRaw` 很简单：

```go
func (r *gitCliBackend) DiffWorkdirRaw(filePath string) (string, error) {
    args := []string{"diff"}
    if filePath != "" {
        args = append(args, "--", filePath)
    }

    output, err := r.runner.run(gitCliRunRequest{Dir: r.path, Args: args})
    if err != nil {
        return "", gitCliError("git diff 失败", output, err)
    }
    return output, nil
}
```

这次改完以后，它仍然保留 `git diff` 作为主来源，但会额外读取未跟踪文件：

```go
untrackedDiff, err := r.diffUntrackedFilesRaw(filePath)
if err != nil {
    return "", err
}
return joinRawDiffs(output, untrackedDiff), nil
```

未跟踪文件列表通过 Git 自己来获取：

```bash
git ls-files --others --exclude-standard -z
```

这里有几个细节。

第一，使用 `--exclude-standard`，这样 `.gitignore`、`.git/info/exclude` 和全局 ignore 规则都会生效。否则一些不应该进入 Git 视野的构建产物、缓存文件也可能被智能分组读到。

第二，使用 `-z`，避免路径里存在空格或者特殊字符时被普通换行拆错。

第三，保留 `filePath` 过滤能力。因为后面点 √ 暂存某个分组时，会按分组文件逐个读取：

```ts
invokeGit('diff.workdirRaw', { path: filePath })
```

所以 Sidecar 层需要支持只为指定未跟踪文件生成 patch。

---

## 五、新增文件 patch 为什么要手动合成

未跟踪文件不在 index 里，也不在 HEAD 里。它对 Git 来说还不是“某个版本和另一个版本之间的差异”，所以 `git diff` 默认不会输出它。

但对智能分组来说，一个新增文本文件完全可以表达成标准 unified diff：

```diff
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..0000000
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
```

这次 Sidecar 做的事情就是把未跟踪文件读出来，然后渲染成类似这样的 new file patch。

对于普通文本文件，会写出：

```text
diff --git
new file mode
index 0000000..0000000
--- /dev/null
+++ b/<path>
@@ -0,0 +1,N @@
新增行内容
```

对于二进制文件，不尝试把内容塞进文本 diff，而是输出：

```text
Binary files /dev/null and b/<path> differ
```

这可以让上层知道它是一个新增文件，同时避免把二进制内容误当成文本处理。

另外，为了避免路径穿越问题，读取未跟踪文件前还做了一层仓库相对路径校验：

```go
cleanPath := filepath.Clean(filepath.FromSlash(gitPath))
if cleanPath == "." ||
   cleanPath == ".." ||
   filepath.IsAbs(cleanPath) ||
   strings.HasPrefix(cleanPath, ".."+string(os.PathSeparator)) {
    return "", fmt.Errorf("invalid repository relative path: %s", gitPath)
}
```

这类校验看起来有点啰嗦，但放在 Sidecar 文件读取边界上是值得的。因为 raw diff 能力最终会触碰本地文件系统，路径必须保持在仓库内部。

---

## 六、Renderer 分析阶段不能再二选一 diff

Sidecar 能看到未跟踪文件以后，Renderer 这里也顺手修了一个旧逻辑。

原来分析阶段是：

```ts
const diff = workdirDiff.diff || stagedDiff.diff
```

这意味着只要工作区 diff 不为空，就会完全忽略暂存区 diff。

这在一些混合场景里不够准确。比如：

```text
暂存区里有 A 文件
工作区里有 B 文件
```

此时智能分组应该理解当前仓库里同时存在 A 和 B 两类变更，而不是只看工作区的 B。

所以这次改成合并两个 diff：

```ts
function combineDiffs(...diffs: string[]): string {
  const parts = diffs.map((diff) => diff.trimEnd()).filter((diff) => diff.trim().length > 0)
  return parts.length > 0 ? `${parts.join('\n')}\n` : ''
}
```

分析入口改成：

```ts
const diff = combineDiffs(workdirDiff.diff, stagedDiff.diff)
```

这样智能分组阶段读取的是“当前可见的全部变更上下文”。这一步仍然不修改暂存区，只是把两侧 diff 合并成一次分析输入。

---

## 七、点 √ 前为什么要先清空暂存区

另一个用户反馈也很关键：如果用户点击 √ 之前暂存区已经有东西，正确逻辑应该是什么？

旧逻辑是把所选分组继续 add 进去：

```text
已有暂存内容 + 所选分组内容
```

这在普通 Git 操作里可以理解，但在“按意图分组暂存”的语义里不对。

因为用户点击 √ 的含义不是“把这个分组追加到暂存区”，而是“按照这个建议，把暂存区切换成这个分组”。

如果不先清空暂存区，就会出现这样的情况：

```text
暂存区原来有登录模块修改
智能分组建议选择 README 文档修改
点击 √ 后暂存区同时存在登录模块和 README
提交时把两个意图混在一起
```

这正好违背了智能分组的目标：帮助用户把不同提交意图拆开。

所以这次在 `stageGroupAndGenerateMessage` 里加了一步：

```ts
await unstageCurrentFiles()
```

`unstageCurrentFiles` 会先刷新状态，然后找出所有当前 staged 文件：

```ts
function getStagedFiles(): string[] {
  return normalizeFiles(useGitStatusStore.getState().fileStatuses.filter(isStagedFile).map((file) => file.path))
}
```

再逐个执行：

```ts
await invokeGit('staging.remove', { path: filePath })
```

这样点击 √ 的流程就变成：

```text
刷新状态
找出当前暂存文件
逐个取消暂存
读取所选分组的 workdir raw diff
按 hunk 或文件级暂存所选分组
刷新状态
读取 staged diff
生成该分组提交信息
```

这个顺序还有一个额外好处：如果某个候选分组文件之前已经被暂存，先取消暂存以后，它会重新回到工作区 diff 里。后面的分组暂存逻辑就可以统一从 workdir raw diff 里读取它，而不是在 staged 和 workdir 之间做复杂分叉。

---

## 八、为什么没有直接清空整个 index

这里还有一个实现选择：清空暂存区可以用逐个 `staging.remove`，也可以考虑提供一个“unstage all”命令。

这次选择了逐个 remove。

原因是当前 Sidecar 已经稳定提供了：

```text
staging.remove
```

它的语义是取消某个文件暂存，并保留工作区内容。这个语义正好符合智能分组暂存前的准备动作。

如果为了这次需求单独新增一个 `staging.removeAll`，需要同步更新：

```text
Sidecar command
handler contract
shared GitCommandMap
Renderer git client
service workflow
测试
```

这当然可以做，但对当前问题来说不是必要复杂度。智能分组暂存一次处理的文件数量通常也不会大到逐个 remove 成为瓶颈。

所以这次保持改动范围收敛，只复用已有命令。

---

## 九、补充测试：确保分析不会偷偷暂存

这次在 Sidecar 增加了一个回归测试文件：

```text
sidecar/internal/git/staging_hunk_test.go
```

核心测试场景是：创建一个未跟踪新文件，然后调用 `DiffWorkdirRaw`。

期望结果有三点。

第一，workdir raw diff 能看到新增文件：

```text
diff --git a/new.txt b/new.txt
new file mode 100644
--- /dev/null
+++ b/new.txt
+hello
+world
```

第二，staged raw diff 仍然为空：

```go
stagedRaw, err := repo.DiffStagedRaw("")
if strings.TrimSpace(stagedRaw) != "" {
    t.Fatalf("workdir raw diff should not stage untracked files")
}
```

这点非常重要。因为它证明“分析能看到新增文件”不是通过偷偷 `git add` 实现的。

第三，文件状态仍然是 untracked：

```go
status := requireFileStatus(t, repo, path)
if status.Staging != StatusUntracked || status.Worktree != StatusUntracked {
    t.Fatalf("expected file to remain untracked")
}
```

这个测试直接覆盖了这次 bug 的核心约束：

```text
能分析未跟踪新增文件
但分析动作不能改变暂存区
```

另外还补了一个路径过滤测试，确保读取指定文件 diff 时，不会把其他未跟踪文件一起带进来。

---

## 十、验证结果

这次改完以后，跑了两类检查。

Sidecar Git 包测试：

```bash
go test ./internal/git
```

因为沙箱环境下默认 Go build cache 写用户目录会受限，所以实际验证时把 `GOCACHE` 指到了工作区内：

```powershell
$env:GOCACHE='E:\IntelliGit\sidecar\.go-build-cache'
go test ./internal/git
```

结果通过：

```text
ok intelligit-sidecar/internal/git
```

Renderer 类型检查：

```bash
npm.cmd run typecheck
```

结果也通过：

```text
typecheck:node passed
typecheck:web passed
```

期间也跑过 `npm.cmd run lint`，项目里仍然有一些既有的 Prettier warning 和 main process 侧的显式返回类型提示。这些不是这次智能分组修复引入的问题，所以没有在这次改动里顺手扩大范围处理。

---

## 十一、这次修复后的流程

现在智能分组暂存的行为可以概括成三段。

第一段，分析阶段：

```text
读取 workdir raw diff
其中包含普通工作区修改和未跟踪新增文件
读取 staged raw diff
合并两边 diff
交给智能分组 provider 分析
```

这一段不改变暂存区。

第二段，用户选择分组后点击 √：

```text
刷新当前 Git 状态
取消已有暂存文件
读取所选分组对应文件的 workdir raw diff
按 hunk 或整文件暂存分组内容
```

这一段会修改暂存区，但只在用户明确确认分组之后发生。

第三段，生成提交信息：

```text
读取所选分组暂存后的 staged diff
结合分组上下文生成 Conventional Commits 信息
回填提交输入框
```

这样一来，智能分组暂存的语义就比较完整了：

```text
分析是只读的
√ 是切换暂存区到所选分组
提交信息只基于所选分组生成
```

---

## 十二、这次问题带来的一个提醒

这次 bug 的根源其实不是一个很复杂的算法问题，而是一个 Git 行为细节：

```text
git diff 默认不包含 untracked 文件
```

这个细节在普通命令行使用里很常见，大家也能理解。但一旦把它放到“智能分析当前所有变更”的产品语义里，就会变成一个明显的断层。

对 IntelliGit 这种 Git 图形工具来说，底层 Git 命令的语义和上层产品语义之间，经常需要一层转换。

这次 `diff.workdirRaw` 的变化就是这种转换：

```text
底层 Git 语义：git diff 不看 untracked
产品分析语义：当前工作区新增文件也属于可分析变更
Sidecar 适配层：git diff + untracked new file patch
```

同样，点击 √ 前清空暂存区也是这种转换：

```text
底层 Git 语义：git add 是追加到 index
产品分组语义：选择分组是切换到该分组
Renderer workflow：先 unstage，再 stage selected group
```

所以这次修复让我更明确了一点：Git 客户端不能只是把 Git 命令原样包一层按钮。很多时候，真正需要设计的是“这个按钮在产品语义里代表什么”，然后再决定底层应该怎样组合 Git 能力。

---

## 十三、后续可以继续优化的方向

这次修复以后，文件级智能分组的闭环更完整了，但后续还可以继续往两个方向推进。

第一个方向是 hunk 级分组。

当前分组主要还是围绕文件来做。如果一个文件里同时包含两个提交意图，系统仍然很难完全自动拆开。后续可以继续增强：

```text
raw diff hunk 解析
AST ownerLabel
hunk 与提交意图的映射
局部 applyPatch 暂存
```

第二个方向是更明确的暂存区保护提示。

现在点击 √ 会先清空已有暂存区，这是符合智能分组语义的。但从用户体验上看，如果暂存区原本已经有内容，未来可以在 UI 上给一个更明确的提示，例如：

```text
将替换当前暂存区为所选分组
```

这样用户会更容易理解这个按钮不是普通 Git add，而是语义化暂存动作。

---

## 十四、总结

这次修复表面上是“新增文件不先暂存就无法智能分组”，实际拆开以后包含两个关键点。

第一个关键点是 diff 输入。智能分析需要看到当前所有变更，所以 Sidecar 的 `diff.workdirRaw` 不能只等价于 `git diff`，还要补齐未跟踪新增文件的 new file patch。

第二个关键点是暂存语义。用户点击 √ 选择一个智能分组时，系统不应该把这个分组简单追加到已有暂存区，而应该先取消当前暂存，再只暂存所选分组。

修完之后，流程终于更接近最初设计的“语义化暂存”：

```text
先分析
再选择
再暂存
再提交
```

分析阶段不污染暂存区，确认阶段才改 index；新增文件不需要用户先手动暂存，已有暂存内容也不会意外混进所选分组提交里。

这类修复不一定有很大的界面变化，但它会让整个工作流的语义更可靠。对一个帮助用户组织提交的 Git 工具来说，这种可靠性其实非常关键。
