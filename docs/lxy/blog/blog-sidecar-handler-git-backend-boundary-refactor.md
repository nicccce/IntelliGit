> 本文为山东大学软件学院创新实训项目博客

# IntelliGit Sidecar Handler 与 Git Backend 边界重构

这次做的是 IntelliGit 后端 Sidecar 结构的一次比较彻底的整理。

在前面几轮前端重构中，我们已经把很多明显的大块结构拆开了：`MainApp.tsx` 被拆成了 `app/`、`layout/`、`views/`、`components/`，全局 store 被拆成多个 Zustand store，组件订阅也进一步整理出了 selector、view model 和 service workflow。到这个阶段，前端的边界已经比最早清楚很多。

但项目不是只有前端。IntelliGit 的很多核心能力其实都在 Go Sidecar 里：打开仓库、读取状态、暂存文件、创建提交、切换分支、拉取推送、生成 diff、处理 merge。这些能力都需要穿过 Electron 主进程和 Go 子进程之间的 IPC 协议，最后落到底层 Git 操作上。

所以当前端逐渐变清楚以后，我重新回到 Sidecar 看了一遍，发现后端也到了一个类似的阶段：功能已经能跑，但结构还停留在“先把能力堆起来”的状态。

这次重构主要处理两个问题：

```text
问题 8：Go handler 层是后端版“大文件”
问题 9：Git 实现策略混杂
```

看起来一个是文件太长，一个是 go-git 和系统 Git CLI 混用。但真正做下来以后，我发现它们其实是同一个结构问题的两个侧面：

```text
handler 层没有清楚的命令边界；
Git 层没有清楚的实现策略边界。
```

这篇博客就记录一下，我是怎么把 Sidecar 后端从“一个 handler 大文件 + 一个混合 Repository”整理成“协议 handler 层 + Repository facade + go-git backend + Git CLI backend”的。

---

## 一、问题不是 817 行，而是所有东西都挤在同一个层里

这次重构前，Sidecar 的 handler 主要集中在：

```text
sidecar/internal/handler/handlers.go
```

这个文件有 817 行，里面放了几乎所有业务命令：

```text
repo.open
repo.init
repo.clone
repo.head
repo.isClean

staging.status
staging.add
staging.remove
staging.applyPatch

commit.create
commit.log
commit.reset

branch.list
branch.checkout

remote.fetch
remote.pull
remote.push

merge.status
merge.abort
merge.continue

diff.workdir
diff.staged
diff.commitPatch
```

最直观的问题当然是文件长。但如果只是因为文件长，就把它机械地剪成几个文件，其实意义不大。因为真正的问题不是“817 行”，而是 handler 层承担了太多不同性质的工作。

比如一个普通的 handler 里，往往会同时做这些事情：

```text
从 Context 里取当前 repo
定义匿名 payload struct
Bind JSON payload
检查必填字段
给字段补默认值
创建 ProgressWriter
调用 git.Repository 方法
用 map 临时拼返回结构
处理部分特殊错误
```

这让 handler 变成了一个混合层。它既像协议层，又像参数校验层，又像业务编排层，还夹杂了一些返回结构定义。

例如原来很多返回结果会直接写成：

```go
return map[string]string{"hash": hash}, nil
```

或者：

```go
return map[string]bool{"clean": clean}, nil
```

这种写法短期很快，但长期会带来一个问题：后端返回结构没有名字。没有名字，就很难讨论，也很难被后续维护者稳定引用。

payload 也是类似情况。很多 handler 内部直接定义匿名 struct：

```go
var params struct {
	Path string `json:"path"`
}
```

这意味着参数契约只存在于某个函数内部。后续如果要对照前端的 TypeScript command map，很难一眼看出 Go 端每个 command 对应的 payload 和 result 到底是什么。

所以这次 handler 重构的目标不是简单拆文件，而是把 handler 层重新定义成：

```text
handler 只负责 IPC 命令边界。

它应该清楚地说明：
这个 command 叫什么；
payload 长什么样；
result 长什么样；
参数怎么校验；
最后调用 Repository 的哪个稳定方法。
```

---

## 二、先把 handler 的“业务域”拆出来

我做的第一步，是删除原来的大文件：

```text
sidecar/internal/handler/handlers.go
```

然后按照业务域拆成：

```text
sidecar/internal/handler/
  repo_handlers.go
  staging_handlers.go
  commit_handlers.go
  branch_handlers.go
  remote_handlers.go
  merge_handlers.go
  diff_handlers.go
```

这样以后改某一类命令时，就有了很明确的入口。

例如仓库管理相关命令都在 `repo_handlers.go`：

```go
func registerRepoHandlers(r *Router) {
	r.Register(CommandRepoOpen, handleRepoOpen)
	r.Register(CommandRepoInit, handleRepoInit)
	r.Register(CommandRepoClone, handleClone)
	r.Register(CommandRepoHead, handleHead)
	r.Register(CommandRepoIsClean, handleIsClean)
}
```

暂存区相关命令都在 `staging_handlers.go`：

```go
func registerStagingHandlers(r *Router) {
	r.Register(CommandStagingStatus, handleStatus)
	r.Register(CommandStagingAdd, handleAdd)
	r.Register(CommandStagingAddAll, handleAddAll)
	r.Register(CommandStagingRemove, handleRemove)
	r.Register(CommandStagingRestore, handleRestore)
	r.Register(CommandStagingApplyPatch, handleApplyPatch)
	r.Register(CommandStagingUnstageHunk, handleUnstageHunk)
}
```

最终 `registry.go` 只负责总装配：

```go
func RegisterAll(r *Router) {
	registerRepoHandlers(r)
	registerStagingHandlers(r)
	registerCommitHandlers(r)
	registerBranchHandlers(r)
	registerRemoteHandlers(r)
	registerMergeHandlers(r)
	registerDiffHandlers(r)
}
```

这一步的好处很直接：以后新增一个 `branch.rename`，我不需要打开一个几百行的大文件去找位置，而是进入 `branch_handlers.go`。新增一个 `diff.blame`，就进入 `diff_handlers.go`。

文件变短只是表象，真正变清楚的是所有权。

---

## 三、把 command 名字从字符串变成常量

原来注册命令时直接写字符串：

```go
r.Register("repo.open", handleRepoOpen)
r.Register("staging.status", handleStatus)
r.Register("remote.pull", handlePull)
```

这种写法的问题是：命令名散落在注册代码里，后续如果拼错一个字符，Go 编译器不会提醒。虽然前端还有 TypeScript command map，但 Go 端自己没有一个命令名入口。

所以我新增了：

```text
sidecar/internal/handler/commands.go
```

里面集中定义 command 常量：

```go
const (
	CommandRepoOpen    = "repo.open"
	CommandRepoInit    = "repo.init"
	CommandRepoClone   = "repo.clone"
	CommandRepoHead    = "repo.head"
	CommandRepoIsClean = "repo.isClean"

	CommandStagingStatus      = "staging.status"
	CommandStagingAdd         = "staging.add"
	CommandStagingAddAll      = "staging.addAll"
	CommandStagingRemove      = "staging.remove"
	CommandStagingRestore     = "staging.restore"
	CommandStagingApplyPatch  = "staging.applyPatch"
	CommandStagingUnstageHunk = "staging.unstageHunk"
)
```

注册时就变成：

```go
r.Register(CommandRepoOpen, handleRepoOpen)
```

这不是为了少写几个引号，而是为了让命令名成为一个可以被搜索、被测试、被维护的结构。

后续如果要做更进一步的前后端协议生成，Go 端 command 常量也会是一个更好的起点。

---

## 四、给 payload 和 result 起名字

拆完 handler 文件以后，我继续处理 payload 和 result。

我新增了一组 contract 文件：

```text
contract_repo.go
contract_staging.go
contract_commit.go
contract_branch.go
contract_remote.go
contract_merge.go
contract_diff.go
```

例如 repo 相关 contract：

```go
type repoOpenPayload struct {
	Path string `json:"path"`
}

type repoInitPayload struct {
	Path string `json:"path"`
	Bare bool   `json:"bare"`
}

type repoPathResult struct {
	Path string `json:"path"`
}

type repoHeadResult struct {
	Hash   string `json:"hash"`
	Branch string `json:"branch"`
}
```

commit 相关 contract：

```go
type commitCreatePayload struct {
	Message     string `json:"message"`
	AuthorName  string `json:"authorName"`
	AuthorEmail string `json:"authorEmail"`
}

type commitHashResult struct {
	Hash string `json:"hash"`
}
```

这样 handler 里的结构就清楚很多。比如创建提交现在是：

```go
func handleCommit(ctx *Context) (any, error) {
	repo, err := ctx.Repo()
	if err != nil {
		return nil, err
	}

	payload, err := bindPayload[commitCreatePayload](ctx)
	if err != nil {
		return nil, err
	}
	if err := requireParam("message", payload.Message); err != nil {
		return nil, err
	}

	hash, err := repo.Commit(payload.Message, payload.AuthorName, payload.AuthorEmail)
	if err != nil {
		return nil, err
	}
	return commitHashResult{Hash: hash}, nil
}
```

它现在基本只表达四件事：

```text
我要当前 repo；
我要 commitCreatePayload；
message 是必填；
调用 repo.Commit 并返回 commitHashResult。
```

这就是我希望 handler 层拥有的形状。

---

## 五、Context、Notifier 和 Validation 也拆出来

原来的 `router.go` 里除了 Router，还放了 Context、Notifier 等内容。随着 handler 层继续细化，这些基础设施也应该有自己的位置。

所以我把它们拆成：

```text
context.go
notifier.go
validation.go
router.go
```

`context.go` 只负责请求上下文：

```go
type Context struct {
	RequestID  string
	RawPayload json.RawMessage
	Notifier   *Notifier

	repo      *git.Repository
	setRepoFn func(repo *git.Repository)
}
```

`notifier.go` 只负责向 Node 侧推送通知：

```go
func (n *Notifier) SendProgress(requestID, message string)
func (n *Notifier) SendEvent(event string, data any)
```

`validation.go` 放通用校验和 bind：

```go
func bindPayload[T any](ctx *Context) (T, error)
func requireParam(name string, value string) error
func errMissingParam(name string) error
```

这一步比较细，但很重要。因为如果这些基础能力继续留在 `router.go` 或 handler 文件里，时间久了又会长出一个新的“大文件”。

---

## 六、Git 层的问题：混用 go-git 和 CLI 本身不是错

处理完 handler 以后，第二个重点是 Git 实现层。

IntelliGit 的 Sidecar 现在同时使用了两种方式操作 Git：

```text
go-git
系统 Git CLI
```

一开始看到“混用”两个字，很容易下意识觉得它不好，好像应该统一成一种实现。但真正看完代码以后，我的判断是：混用本身可以接受，甚至是必要的。

原因很简单：不同能力适合不同工具。

`go-git` 很适合处理这些能力：

```text
读取仓库对象
获取状态
暂存文件
创建提交
列出分支
读取 commit
生成结构化 diff
fetch / push
```

它的优点是 Go 内部对象模型清晰，不需要解析终端输出，很多信息能直接以结构体形式拿到。

但有些能力更适合直接走系统 Git CLI：

```text
git apply --cached
git diff 原始 unified diff
git merge --abort
git commit --no-edit
git log --topo-order
```

尤其是 hunk 级暂存、raw diff、merge 工作流这些场景，直接复用 Git 官方 CLI 的语义更稳。强行用 go-git 重写，反而可能出现和真实 Git 行为不一致的问题。

所以问题不在于“项目里同时有 go-git 和 CLI”。问题在于：以前没有一个统一的 adapter 边界。

原来的 `Repository` 既是对 handler 暴露的接口，又直接写 go-git 逻辑，还直接 `exec.Command` 调系统 git。CLI 环境变量、错误包装、stdout/stderr 处理、merge conflict 解析分散在不同文件里。

这样后续排查一个 Git 行为时，会遇到几个问题：

```text
很难第一眼判断这个功能走 go-git 还是 CLI
CLI 调用方式不统一
非交互式环境变量可能漏配
错误信息包装风格不一致
merge conflict 解析散在业务逻辑里
handler 有可能绕过 Repository 直接依赖底层实现
```

所以 Git 层这次不是要消灭某一种实现，而是要把混合策略变成显式结构。

---

## 七、把 Repository 改成 facade

这次最核心的调整，是把 `Repository` 改成一个 facade。

重构后它的结构是：

```go
type Repository struct {
	path  string
	goGit *goGitBackend
	cli   *gitCliBackend
}
```

handler 层还是只认识 `Repository`：

```go
repo.Status()
repo.Commit()
repo.Pull()
repo.ApplyPatch()
repo.MergeStatus()
repo.DiffWorkdirRaw()
```

但这些方法内部会转发到不同 backend。

例如常规状态读取走 go-git：

```go
func (r *Repository) Status() ([]FileStatus, error) {
	return r.goGit.Status()
}
```

hunk patch 暂存走 CLI：

```go
func (r *Repository) ApplyPatch(patchContent string) error {
	return r.cli.ApplyPatch(patchContent)
}
```

raw diff 也走 CLI：

```go
func (r *Repository) DiffWorkdirRaw(filePath string) (string, error) {
	return r.cli.DiffWorkdirRaw(filePath)
}
```

这样做以后，handler 不需要知道底层策略。它只知道自己要调用一个稳定的 Git API。

也就是说，`Repository` 不再是一个什么都亲自干的“大对象”，而是一个后端能力门面：

```text
handler
  -> Repository
    -> goGitBackend
    -> gitCliBackend
```

这个边界对后续扩展很关键。以后如果发现某个能力从 go-git 换成 CLI 更合适，只需要改 Repository 内部转发，不应该影响 handler。

---

## 八、goGitBackend：保留对象模型能力

我把原来直接挂在 `Repository` 上的大部分 go-git 能力迁移到了 `goGitBackend`。

例如这些文件现在主要是 go-git backend 的方法：

```text
branch.go
commit.go
diff.go
operations.go
staging.go
remote.go
```

这些能力适合 go-git：

```text
Head / IsClean
Status / Add / AddAll / Remove / Restore
Commit / Log / GetCommit
Branches / RemoteBranches / CurrentBranch
CreateBranch / DeleteBranch / Checkout
Remotes / AddRemote / SetRemoteURL / RemoveRemote
Fetch / Push
DiffWorkdir / DiffStaged
DiffCommits / DiffWithParent / GetCommitPatch
ResetToCommit / CheckoutCommit / LogAll
```

例如状态读取仍然使用 go-git 的 worktree：

```go
func (r *goGitBackend) Status() ([]FileStatus, error) {
	wt, err := r.repo.Worktree()
	if err != nil {
		return nil, fmt.Errorf("获取 worktree 失败: %w", err)
	}
	status, err := wt.Status()
	if err != nil {
		return nil, fmt.Errorf("获取 status 失败: %w", err)
	}
	// 转换为 IntelliGit 自己的 FileStatus
}
```

这里的重点是：go-git 仍然是后端的核心能力来源之一，但它现在被包在 `goGitBackend` 这个明确边界里。

---

## 九、gitCliBackend：把 Git 原生命令语义集中起来

另一边，我新增了 `gitCliBackend`：

```text
cli_backend.go
staging_hunk.go
merge.go
history_cli.go
```

它负责这些能力：

```text
ApplyPatch
UnstageHunk
DiscardHunk
DiffWorkdirRaw
DiffStagedRaw
MergeStatus
MergeAbort
MergeContinue
RunLocalMerge
LogAllRaw
```

例如 hunk 暂存本质上还是：

```text
git apply --cached --unidiff-zero -
```

重构前每个方法自己创建 `exec.Command`，自己设置目录，自己处理输出。

重构后，业务方法只描述自己要执行什么 Git 命令：

```go
func (r *gitCliBackend) ApplyPatch(patchContent string) error {
	if patchContent == "" {
		return fmt.Errorf("patch 内容不能为空")
	}

	output, err := r.runner.run(gitCliRunRequest{
		Dir:   r.path,
		Args:  []string{"apply", "--cached", "--unidiff-zero", "-"},
		Stdin: strings.NewReader(patchContent),
	})
	if err != nil {
		return gitCliError("git apply --cached 失败", output, err)
	}
	return nil
}
```

这样代码里仍然能清楚看见 Git CLI 的真实命令，但执行细节已经不散落了。

---

## 十、cli_runner：唯一允许 exec git 的地方

这次我特别想解决的一个问题，是 CLI 调用不统一。

系统 Git CLI 在桌面应用里有一个很重要的风险：它可能进入交互模式。比如认证时弹出 Git Credential Manager，或者 merge 时打开编辑器。如果 Go 子进程被这种交互卡住，前端 UI 就会一直等待。

所以所有 CLI 调用都应该统一设置非交互环境：

```text
GIT_MERGE_AUTOEDIT=no
GIT_TERMINAL_PROMPT=0
GCM_INTERACTIVE=never
```

这次新增了：

```text
sidecar/internal/git/cli_runner.go
```

它是生产代码里唯一直接调用 `exec.Command` 的地方：

```go
func (r *gitCliRunner) run(req gitCliRunRequest) (string, error) {
	cmd := exec.Command(r.executable, req.Args...)
	cmd.Dir = req.Dir
	cmd.Env = gitCliEnv()
	cmd.Stdin = req.Stdin

	var output bytes.Buffer
	writer := io.Writer(&output)
	if req.Progress != nil {
		writer = io.MultiWriter(&output, req.Progress)
	}
	cmd.Stdout = writer
	cmd.Stderr = writer

	err := cmd.Run()
	return output.String(), err
}
```

以后如果新增 CLI 能力，就不能在业务文件里直接写：

```go
exec.Command("git", ...)
```

而是必须走：

```go
r.runner.run(gitCliRunRequest{...})
```

这一步的意义很大。它不是让代码更“漂亮”，而是把一个容易出运行时问题的边界集中管理了。

以后如果要增强 CLI 调用，比如加超时、记录命令耗时、脱敏日志、统一错误码，都只需要改 `cli_runner.go`。

---

## 十一、Pull 的混合策略变得更清楚

`remote.pull` 是一个很典型的混合场景。

最理想的情况是 fast-forward pull，这时走 go-git 就够了。但如果本地和远程出现分叉，go-git 的 pull 会遇到 non-fast-forward。此时需要执行本地 merge，而 merge 这件事更适合系统 Git CLI。

重构前，这套逻辑放在 remote 相关实现里，go-git 和 CLI 细节混在一起。

重构后，策略放在 `Repository.Pull`：

```go
func (r *Repository) Pull(remoteName string, auth *AuthMethod, progress io.Writer) error {
	branchRef, err := r.goGit.PullFastForward(remoteName, auth, progress)
	if err == nil {
		return nil
	}
	if !errors.Is(err, gogit.ErrNonFastForwardUpdate) {
		return err
	}

	remoteRef := fmt.Sprintf("%s/%s", remoteName, branchRef.Short())
	return r.cli.RunLocalMerge(progress, remoteRef)
}
```

这个方法现在非常直接地表达了策略：

```text
先尝试 go-git fast-forward pull；
如果成功，结束；
如果不是 non-fast-forward 错误，直接返回；
如果是 non-fast-forward，就用 Git CLI 做本地 merge。
```

这正是 facade 应该做的事情：编排策略，而不是把所有实现细节塞进一个文件。

---

## 十二、认证和冲突解析也被单独收口

这次还顺手把两个容易散落的小边界收了起来。

第一个是认证：

```text
sidecar/internal/git/auth.go
```

里面放：

```text
AuthMethod
resolveAuth
wrapAuthError
```

这样远程操作里不再混着一大段 HTTP/SSH 认证转换逻辑。

第二个是 merge conflict 解析：

```text
sidecar/internal/git/conflicts.go
```

里面放：

```go
func parseConflictedFiles(output string) []string
```

merge 失败时，如果输出里包含冲突信息，就包装成结构化错误：

```go
return &MergeConflictError{
	Info: MergeConflictInfo{
		ConflictedFiles: parseConflictedFiles(message),
		Message:         message,
		MergingBranch:   ref,
	},
}
```

这样前端后续做冲突解决 UI 时，就不需要自己解析一段 CLI 文本，而是可以拿到更稳定的结构化结果。

---

## 十三、移除生产代码里的底层逃逸口

原来的 `Repository` 暴露了：

```go
func (r *Repository) GoGitRepo() *gogit.Repository
```

这个方法在测试里很方便，但放在生产代码里不太合适。

因为一旦生产代码可以拿到底层 `go-git.Repository`，就等于可以绕过 `Repository` facade，直接操作内部对象。这样 facade 边界就会慢慢被打穿。

这次我把生产代码中的 `GoGitRepo()` 移除了。

但测试里确实需要直接操作底层对象，比如设置 config、删除 remote tracking ref、检查底层 reference。所以我把它挪到了 `_test.go` helper：

```text
sidecar/internal/git/repository_test_helpers_test.go
```

这样只有测试代码能用：

```go
func (r *Repository) GoGitRepo() *gogit.Repository {
	return r.goGit.repo
}
```

这个改动很小，但边界意义很明确：

```text
生产代码不能绕过 facade；
测试代码可以在必要时触碰底层状态。
```

---

## 十四、补测试：不是为了覆盖所有 Git，而是守住边界

这次新增了几组测试。

第一组是 handler 注册完整性：

```text
sidecar/internal/handler/registry_test.go
```

它会检查所有已知 command 都被 `RegisterAll` 注册。

这个测试的目的很简单：以后新增 command 常量时，如果忘记注册，测试会立刻提醒。

第二组是 CLI runner 环境变量：

```text
sidecar/internal/git/cli_runner_test.go
```

它检查：

```text
GIT_MERGE_AUTOEDIT=no
GIT_TERMINAL_PROMPT=0
GCM_INTERACTIVE=never
```

这些环境变量看起来只是细节，但在桌面应用里非常重要。它们决定了 Git CLI 是否会卡在交互提示上。

第三组是冲突解析：

```text
sidecar/internal/git/conflicts_test.go
```

它验证 `parseConflictedFiles` 能从 merge 输出里提取冲突文件。

这几组测试都不是为了“覆盖率好看”。它们守的是这次重构建立的结构规则：

```text
命令必须注册；
CLI 必须非交互；
冲突解析必须稳定。
```

---

## 十五、文档也要跟着结构更新

这次我还更新了 Sidecar 文档。

原来的 `sidecar/README.md` 里有一个历史遗留表述：它说 Sidecar 使用的是 `libgit2 + CLI`。但当前源码实际使用的是：

```text
go-git + Git CLI
```

如果不修正这个文档，后续维护者很容易被旧说明带偏。

所以我更新了：

```text
sidecar/README.md
```

并新增：

```text
sidecar/internal/handler/README.md
sidecar/internal/git/README.md
```

`handler/README.md` 记录新增命令应该怎么走：

```text
1. 在 commands.go 增加 command 常量
2. 在对应 contract_*.go 定义 payload/result
3. 在对应 *_handlers.go 实现 handler
4. 在 register*Handlers 中注册
5. 更新 registry_test.go
6. 同步更新前端 Git command map
```

`git/README.md` 记录 Git 实现策略：

```text
常规对象模型、状态、提交、分支、结构化 diff 优先放 goGitBackend
hunk/patch、raw diff、merge、特殊 log 放 gitCliBackend
新增 CLI 能力必须复用 gitCliRunner.run
go-git + CLI 串联流程放 Repository facade
生产代码不要新增 GoGitRepo 这类底层逃逸口
```

结构重构如果没有文档，过一段时间很容易被慢慢改回去。文档不是装饰，它是给后续维护者留的边界说明。

---

## 十六、验证结果

完成后我跑了 Sidecar 全量测试：

```text
cd sidecar && go test ./...
```

结果通过。

然后又跑了项目根目录构建：

```text
npm.cmd run build
```

这个命令包含：

```text
build:sidecar
typecheck:node
typecheck:web
electron-vite build
```

结果也通过。

这说明这次重构虽然动了后端结构，但没有改变现有 command 行为，也没有破坏前端到 Sidecar 的跨进程调用。

---

## 十七、这次重构后，Sidecar 的新增规则变了

完成这次整理以后，Sidecar 后续新增功能时，不能再随手把代码塞进一个大文件。

新增一个 IPC 命令，应该按这个顺序：

```text
commands.go
  -> 增加 command 常量

contract_*.go
  -> 增加 payload/result

*_handlers.go
  -> 实现 handler

registry.go / register*Handlers
  -> 注册命令

registry_test.go
  -> 补注册测试

src/shared/types/gitCommands.ts
  -> 同步前端 command map
```

新增一个 Git 能力，要先判断它属于哪类：

```text
如果是对象模型、状态、提交、分支、结构化 diff
  -> 放 goGitBackend

如果是 hunk/patch、raw diff、merge、特殊 Git CLI 语义
  -> 放 gitCliBackend

如果需要 go-git 和 CLI 串联
  -> 编排放 Repository
```

这个规则比“写在哪里都行，只要能跑”麻烦很多。但我觉得这种麻烦是值得的。

因为 IntelliGit 不是一个只调用三五个 Git 命令的小工具。它后面还会继续加冲突解决、更多 diff 能力、更多分支操作、更多远程操作。如果现在不把边界立起来，以后每加一个功能，都会让 Sidecar 更像一个越来越重的大脚本。

---

## 十八、总结

这次 Sidecar 重构表面上解决了两个问题：

```text
handler 大文件
Git 实现策略混杂
```

但实际收获更大一些。

handler 层现在更像一个真正的协议边界。它知道 command、payload、result 和参数校验，但不关心底层 Git 细节。

Git 层现在更像一个稳定的能力门面。`Repository` 对外提供稳定 API，对内把能力分配给 `goGitBackend` 和 `gitCliBackend`。混用 go-git 和系统 Git CLI 不再是散乱实现，而是明确策略。

我觉得这次重构最重要的变化可以概括成一句话：

```text
不是把代码从一个文件搬到很多文件，而是让每个文件知道自己为什么存在。
```

这种结构整理不会直接让界面多一个按钮，也不会立刻让用户看到新功能。但它会让后续功能更容易长出来，也让每一次修改都更有落点。

对于一个 Git 桌面客户端来说，这样的后端边界是很值得提前打磨的。
