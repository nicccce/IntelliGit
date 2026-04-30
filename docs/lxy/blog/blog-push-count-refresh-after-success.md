> 本文为山东大学软件学院创新实训项目博客

# 记一次 Push 成功后计数不刷新的 Bug 修复

这次修复的是 IntelliGit 顶部工具栏里一个看似很小、但实际牵扯到前端状态刷新和 Go Sidecar 底层引用同步的 Bug。

问题现象非常直观：当当前分支存在未推送的 commit 时，右上角同步按钮会正常显示类似 `Push 1` 的数字提示。这个数字表示本地分支相对于远程分支超前了几个提交。按理说，当用户点击 Push，并且 Push 成功之后，这个数字应该立刻消失，按钮也应该从 Push 状态恢复到 Pull 状态。

但实际测试时却发现：Push 操作已经成功完成，远程仓库也已经收到了提交，可右上角仍然显示 `Push 1`。也就是说，底层 Git 操作已经结束了，界面却还停留在旧状态里。

这个问题一开始很容易被误判成“前端没刷新”。但继续往下查以后会发现，它不只是少调用了一次刷新函数这么简单。因为 IntelliGit 的 Push/Pull 状态不是直接从 `git status` 里读出来的，而是依赖本地分支和远程跟踪分支之间的 ahead/behind 计算。如果 Push 成功后本地的 remote-tracking ref 没有同步更新，即使前端重新刷新，也可能继续读到旧的 ahead 数量。

所以这次修复最后分成了两层：一层在前端，Push 成功后立刻重新刷新全局状态；另一层在 Go Sidecar，Push 成功后主动更新本地远程跟踪分支引用，保证 ahead/behind 的数据源本身也变成正确状态。

---

## 一、问题现象

IntelliGit 顶部工具栏右侧有一个同步按钮。它会根据当前分支的远程同步状态，在 Push 和 Pull 之间自动切换：

```tsx
const hasCommitsToPush = commitsAhead > 0
```

当 `commitsAhead > 0` 时，说明本地有提交还没有推到远程，于是按钮显示 Push：

```tsx
hasCommitsToPush ? (
  `↑ Push ${commitsAhead}`
) : (
  `↓ Pull ${commitsBehind > 0 ? commitsBehind : ''}`
)
```

这段逻辑本身非常简单。UI 并没有自己去判断 Git 历史，也没有额外维护什么复杂状态。它只认一个数字：`commitsAhead`。

这也意味着，如果 Push 成功后按钮仍然显示 `Push 1`，那问题大概率不在按钮组件，而在 `commitsAhead` 没有被更新，或者更新后仍然算出了错误的值。

根据现象，可以把错误链路先粗略写成：

```text
Push 操作成功
  -> commitsAhead 没有变成 0
  -> hasCommitsToPush 仍然为 true
  -> 顶部按钮继续显示 Push 1
```

于是排查重点就从 `Toolbar` 组件转移到了 Zustand Store 里的状态刷新逻辑。

---

## 二、前端 Store 中的刷新链路

在 `src/renderer/src/store/useAppStore.ts` 中，`commitsAhead` 和 `commitsBehind` 是全局状态的一部分：

```ts
commitsAhead: number
commitsBehind: number
```

它们不是手动写死的，而是在 `refreshBranches()` 里通过 Sidecar 命令重新计算：

```ts
const abRes = await window.electronAPI.invokeGit('branch.aheadBehind', {
  branch: data.branch
})

if (abRes.success && abRes.data) {
  const ab = abRes.data as { ahead: number, behind: number }
  set({ commitsAhead: ab.ahead, commitsBehind: ab.behind })
} else {
  set({ commitsAhead: 0, commitsBehind: 0 })
}
```

也就是说，只要 `refreshBranches()` 被调用，并且 Go Sidecar 返回了正确的 ahead/behind，前端按钮状态就会跟着变化。

再继续看更高一级的 `refreshAll()`：

```ts
refreshAll: async () => {
  set({ loading: true })
  const state = get()
  await Promise.all([
    state.refreshStatus(),
    state.refreshHistory(),
    state.refreshBranches()
  ])
  set({ loading: false })
}
```

这个函数会同时刷新文件状态、提交历史和分支状态。换句话说，`refreshAll()` 是前端“把当前仓库状态重新读一遍”的统一入口。

因此，只要 Push 成功后调用一次 `refreshAll()`，理论上 `commitsAhead` 就应该重新计算。

但我检查 `push` 和 `pull` 两个操作时，发现了一个非常明显的不对称。

---

## 三、Push 和 Pull 的刷新逻辑不一致

原来的 `pull` 逻辑是这样的：

```ts
pull: async () => {
  set({ operationLoading: 'pull' })
  try {
    const response = await window.electronAPI.invokeGit('remote.pull', payload)
    if (!response.success) {
      set({ error: `Pull 失败: ${response.error}`, operationLoading: null })
      return
    }
    set({ successMessage: 'Pull 成功' })
    await get().refreshAll()
    setTimeout(() => set({ successMessage: null }), 3000)
  } catch (err) {
    set({ error: `Pull 失败: ${err}` })
  }
  set({ operationLoading: null })
}
```

Pull 成功之后，会立刻调用：

```ts
await get().refreshAll()
```

所以 Pull 之后界面状态会重新读取一遍。

但原来的 `push` 逻辑却是这样的：

```ts
push: async () => {
  set({ operationLoading: 'push' })
  try {
    const response = await window.electronAPI.invokeGit('remote.push', payload)
    if (!response.success) {
      set({ error: `Push 失败: ${response.error}`, operationLoading: null })
      return
    }
    set({ successMessage: 'Push 成功' })
    setTimeout(() => set({ successMessage: null }), 3000)
  } catch (err) {
    set({ error: `Push 失败: ${err}` })
  }
  set({ operationLoading: null })
}
```

这里 Push 成功后只做了两件事：

1. 显示 `Push 成功` 的提示。
2. 三秒后清掉提示。

它没有调用 `refreshAll()`，也没有单独调用 `refreshBranches()`。这就解释了为什么 Push 成功之后，右上角的数字不会立刻消失。

前端第一层修复非常直接：

```ts
set({ successMessage: 'Push 成功' })
await get().refreshAll()
setTimeout(() => set({ successMessage: null }), 3000)
```

这样一来，Push 成功后前端会重新执行：

```text
refreshAll()
  -> refreshBranches()
  -> branch.current
  -> branch.aheadBehind
  -> 更新 commitsAhead / commitsBehind
```

到这里为止，表面上的问题似乎已经解决了。但继续往下看 Go Sidecar 的实现后，我发现还有一个更底层的隐患。

---

## 四、为什么只刷新前端还不够

IntelliGit 计算 `commitsAhead` 的地方在 Go 侧的 `sidecar/internal/git/branch.go`。核心函数是 `AheadBehind`。

它的基本思路是拿两个引用做比较：

```text
refs/heads/<branch>
refs/remotes/origin/<branch>
```

也就是本地分支和本地保存的远程跟踪分支。

例如当前分支是 `master`，那么它比较的是：

```text
refs/heads/master
refs/remotes/origin/master
```

如果本地 `master` 比 `origin/master` 多一个提交，那么结果就是：

```json
{"ahead":1,"behind":0}
```

这个设计本身没有问题，Git 里 ahead/behind 本来就是基于本地引用计算出来的。但关键在于：`refs/remotes/origin/master` 是一个本地的 remote-tracking ref，它不等于远程服务器上的真实分支本身。

正常使用 Git CLI 时，`git push` 之后本地的远程跟踪引用通常也会被更新到新的提交位置，所以再次计算 ahead 时会得到 0。

但 IntelliGit 底层使用的是 go-git。原来的 Push 实现只有：

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

这段代码只负责把本地提交推到远程，但没有显式更新本地的 `refs/remotes/<remote>/<branch>`。

于是就可能出现这样的情况：

```text
Push 已经成功
  -> 远程服务器上的 master 已经更新
  -> 本地 refs/remotes/origin/master 仍然停在旧 commit
  -> AheadBehind 继续认为本地领先 1 个 commit
  -> 前端即使 refreshAll，也还是显示 Push 1
```

也就是说，前端刷新只能重新读取状态，但如果底层用于计算状态的引用本身没有变化，刷新再多次也只是读到同一个旧答案。

所以真正稳妥的修复，必须把 Go Sidecar 里的 Push 后置状态也补齐。

---

## 五、Sidecar 中同步 remote-tracking ref

修复思路是：当 go-git Push 成功后，读取当前 HEAD。如果当前 HEAD 位于一个正常分支上，就把对应的远程跟踪分支引用更新到当前 HEAD。

新增的辅助函数如下：

```go
func (r *Repository) updateCurrentRemoteTrackingRef(remoteName string) error {
	headRef, err := r.repo.Head()
	if err != nil {
		return err
	}
	if !headRef.Name().IsBranch() {
		return nil
	}

	remoteRefName := plumbing.NewRemoteReferenceName(
		remoteName,
		headRef.Name().Short(),
	)
	remoteRef := plumbing.NewHashReference(remoteRefName, headRef.Hash())
	return r.repo.Storer.SetReference(remoteRef)
}
```

这里做了几件事：

1. 通过 `r.repo.Head()` 获取当前 HEAD。
2. 判断当前 HEAD 是否是一个普通分支。如果用户处于 detached HEAD 状态，就不更新远程跟踪分支。
3. 通过 `plumbing.NewRemoteReferenceName(remoteName, branchName)` 拼出类似 `refs/remotes/origin/master` 的引用名。
4. 用当前 HEAD 的 hash 创建一个新的 hash reference。
5. 调用 `r.repo.Storer.SetReference(remoteRef)` 写回本地引用。

然后在 `Push` 成功后调用它：

```go
err := r.repo.Push(pushOpts)
if err != nil && err != gogit.NoErrAlreadyUpToDate {
	return fmt.Errorf("push 失败 (%s): %w", remoteName, err)
}
if err := r.updateCurrentRemoteTrackingRef(remoteName); err != nil {
	return fmt.Errorf(
		"push succeeded but failed to update local remote-tracking ref (%s): %w",
		remoteName,
		err,
	)
}
return nil
```

这样 Push 成功之后，Sidecar 会把本地的 remote-tracking ref 同步到当前 HEAD。之后 `AheadBehind()` 再比较：

```text
refs/heads/master
refs/remotes/origin/master
```

两个引用就会指向同一个 commit，返回结果也自然变成：

```json
{"ahead":0,"behind":0}
```

到这一步，数据源和前端刷新链路才真正闭环。

---

## 六、补充一个不依赖网络的测试

为了避免这个问题以后再次出现，我补了一个 Go 单元测试。这个测试不访问 GitHub，也不需要 token，而是在本地临时目录里创建一个 bare remote 仓库。

测试流程如下：

```text
创建临时目录
  -> 初始化 remote.git 作为 bare 仓库
  -> 初始化 local 仓库
  -> local 添加 origin 指向 remote.git
  -> local 新建文件并提交
  -> Push 前检查 ahead=1, behind=0
  -> 执行 repo.Push("origin")
  -> Push 后再次检查 ahead=0, behind=0
```

测试代码的关键断言是：

```go
ahead, behind, err := repo.AheadBehind("master")
if err != nil {
	t.Fatalf("ahead/behind before push: %v", err)
}
if ahead != 1 || behind != 0 {
	t.Fatalf("before push ahead/behind = %d/%d, want 1/0", ahead, behind)
}

if err := repo.Push("origin", nil, io.Discard); err != nil {
	t.Fatalf("push: %v", err)
}

ahead, behind, err = repo.AheadBehind("master")
if err != nil {
	t.Fatalf("ahead/behind after push: %v", err)
}
if ahead != 0 || behind != 0 {
	t.Fatalf("after push ahead/behind = %d/%d, want 0/0", ahead, behind)
}
```

这个测试覆盖的正是本次 Bug 的核心场景：Push 操作本身成功后，ahead/behind 是否会跟着变成正确结果。

最终测试通过：

```powershell
go test -run TestPushUpdatesRemoteTrackingRef ./internal/git
```

前端类型检查也通过：

```powershell
npm.cmd run typecheck:web
```

这里还有一个 Windows 下的小插曲：直接运行 `npm run typecheck:web` 时，PowerShell 会因为执行策略阻止 `npm.ps1`，所以我改用了 `npm.cmd`。这不是项目代码的问题，而是 Windows PowerShell 执行策略导致的命令入口差异。

---

## 七、修复后的完整链路

修复后，用户点击 Push 的完整链路变成了：

```text
用户点击右上角 Push 按钮
  -> 前端调用 useAppStore.push()
  -> Electron IPC 调用 remote.push
  -> Go Sidecar 执行 repo.Push()
  -> go-git 把本地提交推到远程
  -> Sidecar 更新 refs/remotes/<remote>/<branch>
  -> 前端收到 Push 成功
  -> 前端调用 refreshAll()
  -> refreshBranches() 调用 branch.aheadBehind
  -> AheadBehind 比较本地分支和远程跟踪分支
  -> 返回 ahead=0, behind=0
  -> commitsAhead 更新为 0
  -> Toolbar 从 Push 状态恢复为 Pull 状态
```

这样一来，界面显示和真实 Git 状态就重新对齐了。

更重要的是，这个修复不是简单地在前端“把数字清零”。如果只是 Push 成功后写：

```ts
set({ commitsAhead: 0 })
```

看起来也能让按钮消失，但那只是把 UI 强行改成了想要的样子，底层状态并没有被真正修好。万一 Push 后远程跟踪分支还是旧的，下一次刷新又会把 `commitsAhead` 算回 1。

所以这次修复没有选择“骗过界面”，而是让前端刷新链路和 Sidecar 数据源都变正确。

---

## 八、这次 Bug 的启发

这次问题给我的最大提醒是：在桌面客户端里，UI 状态刷新经常不是单点问题，而是一条链路问题。

从界面上看，它只是一个数字没有消失；但真正往下拆，会经过：

```text
React Toolbar
  -> Zustand Store
  -> Electron IPC
  -> Go Sidecar Handler
  -> go-git Push
  -> 本地 Git 引用
  -> AheadBehind 计算
```

任何一环没有更新，最终都会表现为“界面没刷新”。

这也是为什么排查这类问题时，不能只盯着前端组件。组件只是最终展示结果，它不一定是问题源头。更稳妥的方式是顺着数据从哪里来、什么时候更新、依赖哪个底层引用，一层一层往下追。

这次最终改动虽然不多，但修复点很关键：

1. 前端 Push 成功后补上 `refreshAll()`，让界面主动重新读取仓库状态。
2. Sidecar Push 成功后更新 remote-tracking ref，让 ahead/behind 的计算数据源变正确。
3. 增加本地 bare remote 测试，保证 Push 后 ahead 会从 1 变成 0。

表面上看，这是一个按钮数字不刷新的 Bug；本质上，它是一次对“远程同步状态应该由谁维护、何时刷新、以哪个 Git 引用为准”的梳理。

修完以后，IntelliGit 的 Push/Pull 状态链路也更完整了：不是只做到“能 Push”，而是 Push 之后整个应用状态也能准确回到最新位置。
