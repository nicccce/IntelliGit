> 本文为山东大学软件学院创新实训项目博客

# Go Sidecar Repository 并发锁改造：让并发请求安全地进入 Git 仓库层

上一篇博客里，我记录了 IntelliGit Go Sidecar 主循环并发化的过程。

那次改动解决的是一个很直接的性能问题：`sidecar/cmd/sidecar/main.go` 原来读到请求以后，会同步执行 `router.Dispatch(req)`，导致所有请求都在 Go 端排队。后来我把每个请求的实际处理放进 goroutine，并加了最大并发数限制，这样 `remote.fetch` 这种慢请求就不会天然堵住后面的 `staging.status`、`commit.log`、`diff.workdir`。

但并发化不是故事的结尾。它更像是把一条窄路拓宽了。请求终于可以同时进入 Sidecar，可是这些请求最后都会走到同一个地方：

```text
handler
  -> internal/git.Repository
  -> go-git backend / Git CLI backend
  -> 当前打开的 Git 仓库
```

如果多个 goroutine 同时操作同一个 `Repository`，新的问题就出现了：底层仓库状态是否允许并发读写？`go-git` 的 `Worktree`、`Repository`、`Storer` 以及系统 Git CLI 对同一个 `.git` 目录的操作，是否能在没有任何协调的情况下安全交错？

这次修复的目标就是修复计划里的第 2 项：

```text
修改 sidecar/internal/git/repository.go（添加并发锁）
```

简单说，就是给 `Repository` 这个 facade 加一把读写锁，让所有 Git 能力继续从同一个稳定入口出去，但入口内部开始有明确的并发秩序。

---

## 一、为什么主循环并发化以后必须补 Repository 锁

在主循环并发化之前，Sidecar 的实际执行模型是串行的：

```text
请求 A: staging.status
请求 B: remote.fetch
请求 C: diff.workdir

实际执行：
A 完成 -> B 完成 -> C 完成
```

这种模型虽然慢，但有一个“顺手得到”的特性：同一时刻通常只有一个请求真正进入 Git 层。即使 `Repository` 自己没有锁，也不容易暴露并发访问问题。

主循环改成 goroutine 后，模型变成了：

```text
请求 A: staging.status   -> goroutine 1
请求 B: remote.fetch     -> goroutine 2
请求 C: diff.workdir     -> goroutine 3
```

这时候，多个请求可能同时调用同一个 `Repository`：

```text
goroutine 1 -> repo.Status()
goroutine 2 -> repo.Fetch()
goroutine 3 -> repo.DiffWorkdir("src/main.ts")
```

如果不加保护，风险主要有三类。

第一类是读写交错。比如 `Status()` 正在读取 worktree 和 index，另一边 `Add()` 或 `Restore()` 正在修改 index 或工作区，读出来的状态可能处在一个中间态。

第二类是写写交错。比如 `Checkout()`、`Pull()`、`ResetToCommit()` 这类操作都可能改变 HEAD、refs、index、worktree。如果它们和另一个写操作同时发生，结果就很难推理。

第三类是 go-git 和 Git CLI 混用时的边界问题。IntelliGit 的 Git 层不是只用 go-git，也不是只用系统 Git。它是一个 facade：

```text
Repository
  -> goGitBackend
  -> gitCliBackend
```

例如 `Pull()` 先尝试 go-git fast-forward，如果遇到 non-fast-forward，再 fallback 到 Git CLI 做本地 merge。`ApplyPatch()`、`UnstageHunk()`、`MergeContinue()` 等能力也走 CLI。也就是说，真正需要保护的不是某一个 backend，而是当前仓库这个共享资源。

所以锁最合适的位置不是 handler，也不是 `goGitBackend` 或 `gitCliBackend` 内部，而是 `Repository` facade。

---

## 二、Repository facade 本来就是最自然的并发边界

这次改动的目标文件是：

```text
sidecar/internal/git/repository.go
```

这个文件在 Sidecar Git 层里承担的是门面职责。handler 层只依赖它，不直接关心某个能力到底是 go-git 实现，还是 Git CLI 实现。

原来的结构大致是：

```go
type Repository struct {
    path  string
    goGit *goGitBackend
    cli   *gitCliBackend
}
```

然后暴露一批稳定方法：

```go
func (r *Repository) Status() ([]FileStatus, error) {
    return r.goGit.Status()
}

func (r *Repository) Add(path string) error {
    return r.goGit.Add(path)
}

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

可以看到，`Repository` 是所有 Git 操作必经的入口。handler 不会绕过它去直接调 backend。

这正好符合加锁的原则：

```text
谁拥有共享资源的统一入口，谁负责定义并发访问规则。
```

如果把锁加到 handler 层，每个 handler 都要记得自己该拿读锁还是写锁，规则会散掉。如果把锁加到 backend 层，又没法统一协调 go-git 和 Git CLI 的组合操作，比如 `Pull()` 这种“一半 go-git，一半 CLI”的流程。

所以这次我只改 `repository.go`，让它成为仓库级并发控制的唯一关口。

---

## 三、为什么使用 sync.RWMutex

这次没有直接用普通的 `sync.Mutex`，而是用了：

```go
sync.RWMutex
```

原因很简单：IntelliGit 里大量高频请求其实是读操作。

例如：

```text
repo.head
repo.isClean
staging.status
commit.log
branch.list
branch.current
remote.list
diff.workdir
diff.staged
merge.status
```

这些操作会读取仓库状态，但不应该主动改变工作区、index、refs 或 remote 配置。它们之间可以并发执行。

而写操作包括：

```text
staging.add
staging.remove
staging.restore
staging.applyPatch
commit.create
branch.create
branch.delete
branch.checkout
remote.add
remote.setUrl
remote.remove
remote.fetch
remote.pull
merge.abort
merge.continue
commit.reset
commit.checkout
```

这些操作会改变仓库状态，必须独占。

如果用普通 `Mutex`，所有读操作也会被完全串行化。那主循环并发化带来的收益会被削弱很多。比如 `commit.log` 和 `branch.list` 本来可以一起读，现在就没必要互相等待。

因此更合适的模型是：

```text
读 + 读：允许并发
读 + 写：互斥
写 + 写：互斥
```

这正是 `sync.RWMutex` 的语义。

---

## 四、第一步：给 Repository 增加锁字段

实际代码改动的第一步，是增加 `sync` import：

```go
import (
    "errors"
    "fmt"
    "io"
    "sync"

    gogit "github.com/go-git/go-git/v5"
    "github.com/go-git/go-git/v5/plumbing"
)
```

然后在 `Repository` 结构体里增加一把锁：

```go
type Repository struct {
    path  string
    goGit *goGitBackend
    cli   *gitCliBackend
    mu    sync.RWMutex
}
```

这个改动看起来很小，但语义很关键。

它表示从现在开始，`Repository` 不再只是一个简单的转发器。它仍然是 facade，但它多承担了一个职责：

```text
管理当前仓库的并发访问秩序。
```

这里没有改变 `newRepository()` 的创建逻辑，因为 `sync.RWMutex` 的零值就是可用状态：

```go
func newRepository(path string, repo *gogit.Repository) *Repository {
    return &Repository{
        path:  path,
        goGit: newGoGitBackend(repo),
        cli:   newGitCliBackend(path),
    }
}
```

也就是说，不需要额外初始化 `mu`。

---

## 五、读操作：用 RLock 保护共享读取

接下来是给读方法加 `RLock()`。

最简单的例子是 `Status()`：

```go
func (r *Repository) Status() ([]FileStatus, error) {
    r.mu.RLock()
    defer r.mu.RUnlock()

    return r.goGit.Status()
}
```

这表示多个 `Status()` 可以并发执行，`Status()` 和 `Log()`、`Branches()` 这类读操作也可以并发执行。但只要有写操作进来，写操作会等待当前读操作结束；写操作执行期间，新的读操作也要等。

类似地，提交历史读取也加了读锁：

```go
func (r *Repository) Log(max int) ([]CommitInfo, error) {
    r.mu.RLock()
    defer r.mu.RUnlock()

    return r.goGit.Log(max)
}
```

分支读取也一样：

```go
func (r *Repository) Branches() ([]BranchInfo, error) {
    r.mu.RLock()
    defer r.mu.RUnlock()

    return r.goGit.Branches()
}

func (r *Repository) CurrentBranch() (string, error) {
    r.mu.RLock()
    defer r.mu.RUnlock()

    return r.goGit.CurrentBranch()
}
```

Diff 读取也用读锁：

```go
func (r *Repository) DiffWorkdir(filePath string) (*PatchDetail, error) {
    r.mu.RLock()
    defer r.mu.RUnlock()

    return r.goGit.DiffWorkdir(filePath)
}

func (r *Repository) DiffStaged(filePath string) (*PatchDetail, error) {
    r.mu.RLock()
    defer r.mu.RUnlock()

    return r.goGit.DiffStaged(filePath)
}
```

这里有一个容易犹豫的点：`DiffWorkdir()` 虽然只是读，但它会读取 worktree、index 和 blob 内容，耗时可能比较长。那它会不会把写操作挡住？

会的。

但这是正确的代价。因为当 diff 正在基于某个文件状态生成 patch 时，如果另一边同时 `Checkout()`、`Restore()` 或 `ResetToCommit()`，得到的 patch 就可能混入不一致状态。相比“让 diff 和写操作完全自由交错”，让写操作等当前读完成是更稳的选择。

---

## 六、写操作：用 Lock 独占修改仓库状态

所有会改变仓库状态的方法都改成写锁。

暂存文件是典型写操作：

```go
func (r *Repository) Add(path string) error {
    r.mu.Lock()
    defer r.mu.Unlock()

    return r.goGit.Add(path)
}

func (r *Repository) Remove(path string) error {
    r.mu.Lock()
    defer r.mu.Unlock()

    return r.goGit.Remove(path)
}

func (r *Repository) Restore(path string) error {
    r.mu.Lock()
    defer r.mu.Unlock()

    return r.goGit.Restore(path)
}
```

提交也是写操作：

```go
func (r *Repository) Commit(message, authorName, authorEmail string) (string, error) {
    r.mu.Lock()
    defer r.mu.Unlock()

    return r.goGit.Commit(message, authorName, authorEmail)
}
```

分支创建、删除、切换也都是写操作：

```go
func (r *Repository) CreateBranch(name string) error {
    r.mu.Lock()
    defer r.mu.Unlock()

    return r.goGit.CreateBranch(name)
}

func (r *Repository) Checkout(branch string) error {
    r.mu.Lock()
    defer r.mu.Unlock()

    return r.goGit.Checkout(branch)
}
```

远程配置修改也一样：

```go
func (r *Repository) AddRemote(name, url string) error {
    r.mu.Lock()
    defer r.mu.Unlock()

    return r.goGit.AddRemote(name, url)
}

func (r *Repository) SetRemoteURL(name, url string) error {
    r.mu.Lock()
    defer r.mu.Unlock()

    return r.goGit.SetRemoteURL(name, url)
}
```

这些方法本身没有复杂逻辑，真正重要的是分类。只要一个方法会修改 index、worktree、refs、config 或 merge 状态，就不能和其他仓库操作随意并发。

---

## 七、Pull 是这次最需要注意的方法

这次加锁时，我最关注的是 `Pull()`。

因为它不是单纯转发给某一个 backend，而是一个组合流程：

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

它的语义是：

```text
先尝试 go-git fast-forward pull
如果可以快进，直接结束
如果不能快进，fallback 到系统 Git 做本地 merge
```

这里必须让整个流程在同一把写锁里面完成：

```go
func (r *Repository) Pull(remoteName string, auth *AuthMethod, progress io.Writer) error {
    r.mu.Lock()
    defer r.mu.Unlock()

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

如果只锁 `PullFastForward()`，不锁后面的 `RunLocalMerge()`，中间就会出现一个空窗：

```text
goroutine A: PullFastForward 发现不能快进
goroutine A: 准备 fallback merge
goroutine B: Checkout / Reset / Commit 插进来
goroutine A: 继续 RunLocalMerge
```

这会让 `Pull()` 的语义变得不完整。用户发起的是一个 pull 操作，内部不管是 fast-forward 还是 merge fallback，都应该被看成同一次仓库写操作。

所以这次的原则是：

```text
一个 Repository 方法代表一个业务级 Git 操作。
只要它是写操作，锁要覆盖整个方法，而不是只覆盖其中某几行。
```

---

## 八、CLI patch 和 merge 操作也必须纳入同一把锁

IntelliGit 里有一些能力天然更适合走系统 Git CLI，比如：

```text
staging.applyPatch
staging.unstageHunk
staging.discardHunk
merge.abort
merge.continue
diff.workdirRaw
diff.stagedRaw
logAllRaw
```

这里也不能因为它们不是 go-git 调用，就放在锁外面。

例如 patch 相关操作都会改 index 或工作区：

```go
func (r *Repository) ApplyPatch(patchContent string) error {
    r.mu.Lock()
    defer r.mu.Unlock()

    return r.cli.ApplyPatch(patchContent)
}

func (r *Repository) UnstageHunk(patchContent string) error {
    r.mu.Lock()
    defer r.mu.Unlock()

    return r.cli.UnstageHunk(patchContent)
}

func (r *Repository) DiscardHunk(patchContent string) error {
    r.mu.Lock()
    defer r.mu.Unlock()

    return r.cli.DiscardHunk(patchContent)
}
```

merge 状态读取是读锁：

```go
func (r *Repository) MergeStatus() (*MergeStatusResult, error) {
    r.mu.RLock()
    defer r.mu.RUnlock()

    return r.cli.MergeStatus()
}
```

但 abort 和 continue 是写锁：

```go
func (r *Repository) MergeAbort() error {
    r.mu.Lock()
    defer r.mu.Unlock()

    return r.cli.MergeAbort()
}

func (r *Repository) MergeContinue(message string) error {
    r.mu.Lock()
    defer r.mu.Unlock()

    return r.cli.MergeContinue(message)
}
```

这个分类很重要。因为从 `Repository` 的角度看，不管底层是 go-git 还是 Git CLI，它们操作的是同一个 `.git` 目录和同一个工作区。

也就是说，锁保护的对象不是某个 Go 对象本身，而是“当前仓库状态”这个更大的资源。

---

## 九、Push 为什么暂时用读锁

这次我把 `Push()` 包成了读锁：

```go
func (r *Repository) Push(remoteName string, auth *AuthMethod, progress io.Writer) error {
    r.mu.RLock()
    defer r.mu.RUnlock()

    return r.goGit.Push(remoteName, auth, progress)
}
```

这可能看起来有一点微妙。因为 push 是远程操作，听起来像“写”。但它主要写的是远端仓库，本地仓库通常只是读取当前 refs、对象和认证信息，然后把对象发送出去。

从本地共享资源保护的角度看，它不像 `Fetch()` 那样会更新本地 remote refs，也不像 `Pull()` 那样会改变 worktree 或 HEAD。因此这次先把它归为本地读操作。

不过这里也留下一个后续可以继续评估的点：如果后面发现 go-git 的 `Push()` 会修改本地某些状态，或者我们给 push 增加了本地状态写入，比如记录 push metadata、刷新本地 refs，那么它也应该升级为写锁。

这次的分类标准是：

```text
以当前代码对本地仓库状态的影响为准。
```

---

## 十、完整分类结果

这次改完后，`Repository` 里的方法大致分成两类。

读锁方法：

```text
Path
Head
IsClean
Status
Log
LogFrom
GetCommit
Branches
RemoteBranches
CurrentBranch
AheadBehind
Remotes
Push
MergeStatus
DiffWorkdir
DiffStaged
DiffWorkdirRaw
DiffStagedRaw
DiffCommits
DiffWithParent
GetCommitPatch
FileContentAtCommit
ListFilesAtCommit
LogAll
LogAllRaw
```

写锁方法：

```text
Add
AddAll
AddGlob
Remove
Restore
ApplyPatch
UnstageHunk
DiscardHunk
Commit
CreateBranch
DeleteBranch
Checkout
CheckoutNewBranch
AddRemote
SetRemoteURL
RemoveRemote
Fetch
Pull
MergeAbort
MergeContinue
ResetToCommit
CheckoutCommit
```

这里的重点不是“每个函数前面多了两行代码”，而是 Git 层终于有了清晰的并发契约：

```text
查询类操作可以一起跑。
修改类操作必须独占仓库。
查询和修改不能交错在同一个仓库状态上。
```

这让前面主循环并发化后的风险被收回到一个明确边界里。

---

## 十一、这次改动没有改变 handler 和前端协议

这次修复的一个好处是，它完全发生在 Sidecar 内部。

前端仍然这样发请求：

```text
window.electronAPI.invokeGit("staging.status")
window.electronAPI.invokeGit("remote.fetch")
window.electronAPI.invokeGit("diff.workdir")
```

Electron Main 仍然只负责把请求转发给 Sidecar。

handler 仍然只调用：

```go
ctx.Repo.Status()
ctx.Repo.Fetch(...)
ctx.Repo.DiffWorkdir(...)
```

真正变化的是 `Repository` 内部多了一层并发控制。

这也符合之前 Sidecar 重构时确定的边界：handler 不关心某个能力走 go-git 还是 Git CLI，也不应该关心锁策略。handler 要表达的是“我要执行某个 Git 命令”；Repository 要负责的是“这个命令在当前仓库里怎样安全执行”。

---

## 十二、验证过程

改动完成后，我先执行了格式化：

```bash
gofmt -w sidecar/internal/git/repository.go
```

然后运行 Sidecar 端测试：

```bash
cd sidecar
go test ./...
```

第一次在沙箱内运行时，Go 构建缓存目录被当前环境拦住了：

```text
open C:\Users\pc23\AppData\Local\go-build\...\*.d: Access is denied
```

这不是代码编译错误，而是测试过程需要访问用户级 `go-build` cache。按规则提升权限后重新运行，测试通过：

```text
?    intelligit-sidecar/cmd/sidecar       [no test files]
ok   intelligit-sidecar/internal/git      10.141s
ok   intelligit-sidecar/internal/handler  2.862s
?    intelligit-sidecar/internal/protocol [no test files]
```

最终本次实际修改的代码文件是：

```text
sidecar/internal/git/repository.go
```

新增内容包括：

```text
1. 引入 sync 包。
2. 在 Repository 上新增 mu sync.RWMutex。
3. 所有只读 facade 方法使用 RLock/RUnlock。
4. 所有会改变本地仓库状态的方法使用 Lock/Unlock。
5. Pull 的 go-git fast-forward 和 CLI merge fallback 被同一把写锁完整包住。
6. Git CLI 的 patch、merge、raw diff、raw log 能力也统一通过 Repository 锁进入。
```

---

## 十三、这次改动和上一篇并发化的关系

如果只看这次代码，可能会觉得它只是给每个方法加锁，没什么复杂逻辑。但放回整个修复计划里，它的位置其实很关键。

上一篇主循环并发化解决的是：

```text
请求不要在 Sidecar 入口处排队。
```

这次 Repository 加锁解决的是：

```text
请求并发进入 Git 层以后，不要把同一个仓库状态读写乱。
```

它们是一前一后的关系：

```text
main.go 并发化
  -> 提高请求调度吞吐
  -> 多个请求可能同时进入 Repository

repository.go 加锁
  -> 明确仓库读写规则
  -> 让并发请求在 Git 层有秩序地执行
```

如果只有主循环并发，没有 Repository 锁，那么性能问题可能缓解了，但数据安全问题会被放大。

如果只有 Repository 锁，没有主循环并发，那么锁虽然存在，但请求仍然在入口处串行排队，读写锁也发挥不出应有价值。

所以这两步要连在一起看。第一步让 Sidecar 有能力并发处理请求，第二步让这种并发不会冲破 Git 仓库层的安全边界。

---

## 十四、总结

这次改动不改变 UI，不改变 IPC 协议，也不改变 handler 的调用方式。它只是在 `Repository` 这个最合适的位置补上了一层仓库级并发控制。

最终得到的模型是：

```text
Sidecar 主循环：
  多个请求可以进入 goroutine 并发处理

Repository facade：
  多个读请求可以同时读取仓库
  写请求独占仓库
  读写请求互斥

go-git / Git CLI backend：
  继续专注各自的 Git 能力实现
```

这一步的价值不只是避免潜在 race。更重要的是，它把“并发之后仓库层应该如何工作”这件事写进了代码结构里。

从此以后，新增 Git 能力时也有了一个非常清楚的判断标准：

```text
如果只是读取当前仓库状态，用 RLock。
如果会改变 index、worktree、refs、config、merge 状态或本地 remote refs，用 Lock。
如果一个方法内部组合了 go-git 和 Git CLI，锁要覆盖整个业务操作。
```

这就是这次 `repository.go` 并发锁改造的完整记录。
