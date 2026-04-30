> 本文为山东大学软件学院创新实训项目博客

# Push/Pull 历史不同步问题的排查与修复记录

这次排查的是 IntelliGit 在测试仓库 `sidecar/test/repo` 中出现的一组远程同步问题。最开始看到的现象是 Push 失败，提示：

```text
Push 失败: push 失败 (origin): non-fast-forward update: refs/heads/master
```

后来在继续修复 Pull 逻辑时，又出现了新的报错：

```text
Pull 失败: pull 失败 (origin): non-fast-forward update
```

再往后，当 Pull 改为走系统 Git CLI 后，错误进一步变成：

```text
fatal: refusing to merge unrelated histories
```

这几个错误表面上看都和远程同步有关，但它们并不是同一个层面的 bug。`non-fast-forward` 说明本地和远程的提交关系不能直接快进；而 `refusing to merge unrelated histories` 更进一步，说明本地分支和远端分支甚至没有共同祖先。

这篇博客主要记录这次问题从 UI 状态、go-git 行为、远程跟踪引用，到 Git CLI 语义差异的完整排查过程。

---

## 一、最初的现象

测试仓库路径是：

```text
E:\IntelliGit\sidecar\test\repo
```

这个目录本身是一个独立 Git 仓库，下面存在 `.git` 目录。用户在软件中进行 Push/Pull 操作后，关闭软件再重新打开，顶部同步按钮会进入一个不符合预期的状态。点击 Push 时，后端返回：

```text
non-fast-forward update: refs/heads/master
```

从正常使用 Git 的经验来看，如果一个仓库只在这个软件里操作，没有其他人手工改远端，那么理论上本地和远端不应该突然出现不可快进的冲突。因此这个问题不能简单归结为“用户本地落后了远端”，而应该先怀疑软件在某个环节维护错了 Git 状态。

我首先检查测试仓库的远程配置：

```powershell
git remote -v
```

结果是：

```text
origin  https://github.com/nicccce/git-test.git (fetch)
origin  https://github.com/nicccce/git-test.git (push)
```

再看本地分支：

```powershell
git branch -vv
```

发现本地只有 `master`，而且没有显示上游分支信息：

```text
* master 80966e5 Add hello.txt for testing
```

这说明 `.git/config` 里没有类似下面的配置：

```ini
[branch "master"]
    remote = origin
    merge = refs/heads/master
```

也就是说，这个仓库虽然有 `origin`，但当前分支并没有明确记录自己的 upstream。

---

## 二、缺失远程跟踪引用带来的误判

继续查看引用时，我发现早期测试仓库里只有本地分支：

```text
refs/heads/master 80966e5...
```

但是没有：

```text
refs/remotes/origin/master
```

这个细节非常关键。IntelliGit 的 ahead/behind 计算依赖两个本地引用：

```text
refs/heads/<branch>
refs/remotes/origin/<branch>
```

也就是本地分支和本地保存的远程跟踪分支。远程跟踪分支并不等于 GitHub 上真实的分支，它只是本地仓库里对远端状态的一份缓存。

如果本地缺失 `refs/remotes/origin/master`，旧版 `AheadBehind` 逻辑会把本地提交全部当成 ahead：

```go
remoteRef, err := r.repo.Reference(
	plumbing.ReferenceName("refs/remotes/origin/"+branchName),
	true,
)
if err != nil {
	// 无远程分支，说明全是 ahead
	iter, err := r.repo.Log(&gogit.LogOptions{From: localRef.Hash()})
	...
	return ahead, 0, nil
}
```

这段逻辑在“远端确实还没有这个分支”的场景下是合理的。但如果只是因为本地从来没有 fetch 过，导致 remote-tracking ref 缺失，那么它就会误判：

```text
本地缺少 origin/master
  -> 误以为远端没有 master
  -> 把本地历史全算成 ahead
  -> UI 显示 Push
  -> 用户点击 Push
  -> 实际远端已经有 master
  -> 远端拒绝非快进更新
```

所以第一个问题不是 GitHub 端突然变化，而是软件启动后没有先把远程跟踪引用刷新到本地，就直接用本地过期信息计算 Push/Pull 状态。

---

## 三、Push 默认行为和 Git CLI 不一致

继续看 Go Sidecar 的 Push 实现，旧代码大致是：

```go
func (r *Repository) Push(remoteName string, auth *AuthMethod, progress io.Writer) error {
	pushOpts := &gogit.PushOptions{
		RemoteName: remoteName,
		Auth:       resolveAuth(auth),
		Progress:   progress,
	}

	err := r.repo.Push(pushOpts)
	if err != nil && err != gogit.NoErrAlreadyUpToDate {
		return fmt.Errorf("push 失败 (%s): %w", remoteName, err)
	}
	return nil
}
```

这里没有指定 `RefSpecs`。go-git 在 `PushOptions.Validate()` 中会使用默认 refspec：

```text
refs/heads/*:refs/heads/*
```

这意味着它更接近“把所有本地分支推到远端对应分支”，而不是普通用户在当前分支上理解的：

```powershell
git push origin master
```

这两者的语义差别很大。对于桌面客户端来说，用户点击顶部的 Push 按钮，直觉上只会推送当前分支，而不是推送所有本地分支。

因此我把 Push 改成显式推当前分支：

```go
branchRef, err := r.currentBranchReferenceName()
if err != nil {
	return err
}

pushOpts := &gogit.PushOptions{
	RemoteName: remoteName,
	RefSpecs: []config.RefSpec{
		config.RefSpec(fmt.Sprintf("%s:%s", branchRef, branchRef)),
	},
	Auth:     resolveAuth(auth),
	Progress: progress,
}
```

如果当前分支是 `master`，最终 refspec 就是：

```text
refs/heads/master:refs/heads/master
```

这样可以避免因为某个非当前分支落后远端，导致当前 Push 按钮也失败。

同时，为了避免 detached HEAD 状态下错误推送，我补了一个统一函数：

```go
func (r *Repository) currentBranchReferenceName() (plumbing.ReferenceName, error) {
	headRef, err := r.repo.Head()
	if err != nil {
		return "", fmt.Errorf("获取 HEAD 失败: %w", err)
	}
	if !headRef.Name().IsBranch() {
		return "", fmt.Errorf("当前处于 detached HEAD 状态 (%s)", headRef.Hash().String()[:8])
	}
	return headRef.Name(), nil
}
```

这一步修复的是 Push 语义问题：软件按钮应该操作当前分支，而不是隐式操作全部分支。

---

## 四、刷新分支状态前先 Fetch

前端状态刷新也需要调整。原来的 `refreshBranches()` 会先读取当前分支，然后直接调用：

```ts
branch.aheadBehind
```

但是如果本地 `origin/master` 本来就是旧的，或者压根不存在，那么 ahead/behind 就不可靠。

因此我在刷新分支状态前增加了一次轻量的 fetch：

```ts
const { currentRepo } = get()
if (currentRepo) {
  await window.electronAPI.invokeGit('remote.fetch', remotePayload(currentRepo))
}
```

这样每次刷新顶部按钮状态时，链路就变成：

```text
refreshBranches()
  -> remote.fetch
  -> 更新 refs/remotes/origin/<branch>
  -> branch.current
  -> branch.aheadBehind
  -> 得到更接近真实远端的 ahead/behind
```

这一步解决的是“用过期远程跟踪引用计算 UI 状态”的问题。

同时顶部按钮也做了一个更保守的判断：

```tsx
const hasCommitsToPush = commitsAhead > 0 && commitsBehind === 0
const hasCommitsToPull = commitsBehind > 0
```

也就是说，只有在本地超前并且没有落后时，按钮才显示 Push。只要本地存在 behind，就优先显示 Pull。

这个判断比原来的：

```tsx
const hasCommitsToPush = commitsAhead > 0
```

更符合 Git 同步的常识。因为一旦同时 ahead 和 behind，就说明本地和远端已经分叉，不能简单把它当成普通 Push。

---

## 五、go-git Pull 的语义限制

修完 Push 和刷新逻辑以后，继续测试 Pull，又遇到了：

```text
Pull 失败: pull 失败 (origin): non-fast-forward update
```

这时问题就不再是 UI 状态误判，而是 go-git 自身的 Pull 行为和 Git CLI 不完全一致。

go-git 的 `Worktree.Pull()` 文档里有一个很重要的限制：它只支持 fast-forward 形式的合并。也就是说，如果远端提交可以直接快进到本地，它能成功；但只要本地和远端出现分叉，它不会像普通 `git pull` 那样自动产生 merge commit，而是直接返回：

```text
non-fast-forward update
```

旧版 Pull 代码是：

```go
wt, err := r.repo.Worktree()
if err != nil {
	return fmt.Errorf("获取 worktree 失败: %w", err)
}

pullOpts := &gogit.PullOptions{
	RemoteName: remoteName,
	Auth:       resolveAuth(auth),
	Progress:   progress,
}

err = wt.Pull(pullOpts)
if err != nil && err != gogit.NoErrAlreadyUpToDate {
	return fmt.Errorf("pull 失败 (%s): %w", remoteName, err)
}
```

这里的问题是，软件界面上的 Pull 按钮，对用户来说应该等价于：

```powershell
git pull origin master
```

而不是“只允许 fast-forward 的 pull”。

因此我把 Pull 从 go-git 实现改成了调用系统 Git CLI：

```go
func (r *Repository) Pull(remoteName string, auth *AuthMethod, progress io.Writer) error {
	branchRef, err := r.currentBranchReferenceName()
	if err != nil {
		return err
	}

	return r.runGitCommand(
		progress,
		"pull",
		"--no-rebase",
		"--no-edit",
		remoteName,
		branchRef.Short(),
	)
}
```

这样 Pull 的实际行为就更接近用户在命令行中执行：

```powershell
git pull --no-rebase --no-edit origin master
```

其中：

```text
--no-rebase
```

表示使用 merge 策略，而不是 rebase。

```text
--no-edit
```

表示如果产生 merge commit，就使用默认合并提交信息，不弹出编辑器。

---

## 六、统一封装 Git CLI 调用

为了让 Sidecar 仍然保留统一入口，我没有在 handler 里直接调用系统命令，而是在 git 业务层封装了一个辅助函数：

```go
func (r *Repository) runGitCommand(progress io.Writer, args ...string) error {
	cmd := exec.Command("git", append([]string{"-C", r.path}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_MERGE_AUTOEDIT=no")

	var output bytes.Buffer
	writer := io.Writer(&output)
	if progress != nil {
		writer = io.MultiWriter(&output, progress)
	}
	cmd.Stdout = writer
	cmd.Stderr = writer

	if err := cmd.Run(); err != nil {
		message := strings.TrimSpace(output.String())
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("git %s 失败: %s", strings.Join(args, " "), message)
	}
	return nil
}
```

这个函数做了几件事：

1. 使用 `git -C <repo path>` 指定仓库目录。
2. 把 stdout 和 stderr 同时收集起来，方便错误时返回完整信息。
3. 如果前端传入了 progress writer，就把 Git CLI 输出同步写给前端进度通道。
4. 设置 `GIT_MERGE_AUTOEDIT=no`，避免 merge commit 触发编辑器。

这样既保留了 Sidecar 的统一协议，也让 Pull 在复杂场景下拥有 Git CLI 的真实行为。

---

## 七、为什么又出现 unrelated histories

当 Pull 改成 Git CLI 后，测试仓库又出现了新的错误：

```text
fatal: refusing to merge unrelated histories
```

这个错误非常关键。它说明问题已经不是普通的分叉，而是本地 `master` 和远端 `master` 没有共同祖先。

我用下面命令确认：

```powershell
git merge-base master origin/master
```

结果没有输出，返回失败。这说明两条历史不是从同一个 root commit 演化出来的。

再看提交图：

```text
* b76fd21 (HEAD -> master) Add hello.txt for testing
* eaca235 (origin/master) test
* 5942db6 test
* 3e21df2 test
* e5e8c4b test
* dd56bd7 test
* 868fb05 test
* c195435 test
* bf92476 test
* 1c7c65d test:!
* dd11c35 Add hello.txt for testing
```

从图上看，两条历史被 `--all` 同时展示出来，但 `merge-base` 找不到公共祖先。这说明当前本地提交和远端提交并不是同一段历史上的“前后关系”。

更明显的是，远端提交曾经出现过空作者：

```text
Author: <>
Commit: <>
```

这和之前修复过的 commit author/email 空写入问题有关。早期 Sidecar 创建 commit 时，无论前端有没有传作者，都会显式构造一个 `object.Signature`：

```go
Author: &object.Signature{
	Name:  authorName,
	Email: authorEmail,
	When:  time.Now(),
}
```

如果前端没有传 `authorName` 和 `authorEmail`，它就会生成：

```text
Author: <>
```

这种提交虽然 Git 可以接受，但会导致 GitHub 用户映射失败，也会让测试仓库历史显得异常。

更重要的是，测试仓库在多次用旧逻辑 init、commit、push、pull 的过程中，本地和远端很可能分别产生了不同的 root commit。这样即使后来 Pull 改成了 Git CLI，也不能直接自动合并，因为 Git 默认拒绝合并无关历史。

---

## 八、为什么不能默认加 allow-unrelated-histories

从命令行角度看，解决这个报错最直接的方法是：

```powershell
git pull --allow-unrelated-histories origin master
```

但是这个参数不能默认放进普通 Pull 逻辑里。

原因很简单：`--allow-unrelated-histories` 是一个非常强的语义。它告诉 Git：

```text
即使这两个分支完全没有共同祖先，也强行把它们合并到一起。
```

这在测试仓库里可能可以接受，但在真实项目里很危险。比如用户不小心把 A 项目的远端配置成 B 项目的地址，如果软件默认允许 unrelated histories，就可能把两个完全无关的项目历史硬合在一起。

因此，正确做法不是在 Pull 中无条件增加：

```text
--allow-unrelated-histories
```

而是把它作为一个明确的冲突处理分支：

```text
普通 Pull
  -> 如果成功，正常结束
  -> 如果提示 refusing to merge unrelated histories
      -> UI 明确提示两端历史无共同祖先
      -> 让用户选择是否执行一次性无关历史合并
```

也就是说，这个选项应该由用户确认，而不是软件静默决定。

---

## 九、针对测试仓库的处理方式

对于 `sidecar/test/repo` 这种测试仓库，有两种可选处理方式。

如果本地提交不重要，希望完全以远端为准，可以执行：

```powershell
git fetch origin
git reset --hard origin/master
```

这会让本地 `master` 直接回到远端 `master`。它最干净，但会丢弃本地未推送提交。

如果本地提交也要保留，可以执行：

```powershell
git pull --allow-unrelated-histories --no-rebase --no-edit origin master
```

这会生成一个合并提交，把本地历史和远端历史接到一起。执行成功后，以后再 Pull/Push 就会回到正常的共同历史链路上。

这两种方案都不应该由软件自动替用户决定。前者会丢本地提交，后者会永久改变历史结构。因此后续 UI 更适合在遇到 unrelated histories 时弹出明确提示。

---

## 十、补充回归测试

为了防止这类问题再次出现，我补了两类测试。

第一类测试覆盖“没有 tracking 配置，也要按当前分支 Pull”：

```go
func TestPullUsesCurrentBranchWithoutTrackingConfig(t *testing.T) {
	...
	if err := repo.GoGitRepo().Storer.RemoveReference(
		plumbing.NewRemoteReferenceName("origin", "master"),
	); err != nil {
		t.Fatalf("remove remote tracking ref: %v", err)
	}
	if err := repo.Pull("origin", nil, io.Discard); err != nil {
		t.Fatalf("pull current branch: %v", err)
	}
	...
}
```

这个测试模拟了本地缺失 `origin/master` 的情况，确保 Pull 会明确拉取当前分支，而不是依赖远端 HEAD 或本地 upstream 配置。

第二类测试覆盖“本地和远端真正分叉时，Pull 能生成 merge commit”：

```go
func TestPullMergesDivergedCurrentBranch(t *testing.T) {
	...
	if err := repo.Pull("origin", nil, io.Discard); err != nil {
		t.Fatalf("pull diverged branch: %v", err)
	}

	headCommit, err := repo.GoGitRepo().CommitObject(headRef.Hash())
	...
	if headCommit.NumParents() != 2 {
		t.Fatalf("merge commit parents = %d, want 2", headCommit.NumParents())
	}
}
```

这个测试证明 Pull 已经不再停留在 go-git 的 fast-forward-only 行为，而是具备了普通 Git CLI 的 merge 能力。

另外还补了 Push 当前分支的测试：

```go
func TestPushOnlyPushesCurrentBranch(t *testing.T) {
	...
	if err := repo.Push("origin", nil, io.Discard); err != nil {
		t.Fatalf("push current branch: %v", err)
	}
	...
}
```

它用来确保 Sidecar 不会再隐式 push 所有本地分支。

---

## 十一、最终修复链路

这次修复后，远程同步的完整链路应该变成：

```text
应用启动 / 刷新状态
  -> remote.fetch
  -> 更新 refs/remotes/origin/<branch>
  -> branch.aheadBehind
  -> 正确计算 ahead / behind

用户点击 Push
  -> 获取当前分支 refs/heads/<branch>
  -> git push 等价语义：只推当前分支
  -> 成功后更新 refs/remotes/origin/<branch>
  -> 前端 refreshAll

用户点击 Pull
  -> 获取当前分支
  -> 调用 git pull --no-rebase --no-edit origin <branch>
  -> fast-forward 场景直接快进
  -> 普通分叉场景生成 merge commit
  -> unrelated histories 场景明确报错，不自动强行合并
```

这样之后，软件的 Push/Pull 语义就更接近用户熟悉的 Git CLI。

---

## 十二、这次问题的反思

这次 Bug 最大的启发是：远程同步状态不能只看“本地是否有 commit”，而必须同时看三个对象：

```text
本地分支 refs/heads/master
本地远程跟踪分支 refs/remotes/origin/master
远端真实分支 refs/heads/master
```

如果不先 fetch，本地远程跟踪分支可能是旧的，甚至不存在。此时 ahead/behind 算出来的结果就不可信。

另一个启发是，go-git 和 Git CLI 虽然都能操作 Git 仓库，但它们的行为边界并不完全一致。go-git 更适合做结构化读取、状态计算、提交创建等可控操作；但对于 Pull 这种会涉及用户本地 Git 配置、merge 策略、编辑器、冲突处理的复杂工作区操作，直接复用系统 Git CLI 反而更贴近用户预期。

所以这次修复不是简单地把某个报错吞掉，而是重新梳理了远程同步的职责边界：

1. 状态刷新前必须先同步远程跟踪引用。
2. Push 只能默认操作当前分支。
3. Pull 需要具备 Git CLI 的 merge 语义。
4. unrelated histories 不能默认强行合并，必须交给用户确认。

表面上看，这是一次 Push/Pull Bug 修复；本质上，它是在把 IntelliGit 的远程同步行为从“能调用 go-git API”推进到“更符合真实 Git 使用习惯”的阶段。
