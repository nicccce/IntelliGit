> 本文为山东大学软件学院创新实训项目博客

# Push/Pull 状态显示错误的排查与修复记录

这次我修的是 IntelliGit 顶部工具栏里的远程同步按钮状态问题。问题表现很简单：测试仓库里明明有一个还没有 push 的 commit，但是软件打开后仍然只显示 Pull，而不是显示 Push。

这个 bug 看起来像是前端按钮判断写错了，但我最后查到的根因其实是运行时 Go Sidecar 二进制太旧，不认识前端调用的 `branch.aheadBehind` 命令。也就是说，前端拿不到 ahead 数量，于是退回默认的 Pull 状态。

---

## 一、UI 判断逻辑

顶部按钮在 `src/renderer/src/MainApp.tsx` 的 `Toolbar` 组件里。它的显示逻辑是：

```tsx
const hasCommitsToPush = commitsAhead > 0
```

按钮点击和文案都依赖这个判断：

```tsx
<button
  className="ig-action-btn"
  onClick={hasCommitsToPush ? push : pull}
  disabled={!currentRepo || !!operationLoading}
  title={hasCommitsToPush ? 'Push commits' : 'Pull commits'}
>
  {operationLoading === 'push' || operationLoading === 'pull' ? (
    <span className="spinner" />
  ) : hasCommitsToPush ? (
    `↑ Push ${commitsAhead}`
  ) : (
    `↓ Pull ${commitsBehind > 0 ? commitsBehind : ''}`
  )}
</button>
```

这说明 UI 本身没有复杂判断。只要 `commitsAhead` 大于 0，它就会显示 Push；否则就显示 Pull。

所以我当时没有急着改按钮，而是继续追 `commitsAhead` 是从哪里来的。

---

## 二、Zustand 里的 ahead/behind 刷新逻辑

在 `src/renderer/src/store/useAppStore.ts` 里，我看到 `commitsAhead` 和 `commitsBehind` 是在 `refreshBranches()` 里刷新的。

核心逻辑是：

```ts
const abRes = await window.electronAPI.invokeGit('branch.aheadBehind', {
  branch: data.branch
})

if (abRes.success && abRes.data) {
  const ab = abRes.data as { ahead: number; behind: number }
  set({ commitsAhead: ab.ahead, commitsBehind: ab.behind })
} else {
  set({ commitsAhead: 0, commitsBehind: 0 })
}
```

这里有一个很关键的行为：如果 `branch.aheadBehind` 调用失败，前端会直接把 ahead 和 behind 都设成 0。

所以“按钮一直显示 Pull”的直接原因很可能是：

```text
branch.aheadBehind 调用失败
  -> commitsAhead 被置 0
  -> hasCommitsToPush 为 false
  -> UI 显示 Pull
```

这个判断让我把排查重点从 React 组件转移到了 Go Sidecar 命令。

---

## 三、测试仓库的真实状态

我先确认测试仓库路径。实际仓库不是：

```text
E:\IntelliGit\sidecar\test
```

而是：

```text
E:\IntelliGit\sidecar\test\repo
```

`sidecar/test/repo` 下面才有 `.git` 目录。

然后我检查本地分支和远程跟踪分支，看到：

```text
refs/heads/master              1c7c65d
refs/remotes/origin/master     dd11c35
```

提交历史是：

```text
* 1c7c65d (HEAD -> master) test:!
* dd11c35 (origin/master) Add hello.txt for testing
```

这说明本地 `master` 比 `origin/master` 多了一个 commit。这个仓库的正确状态应该是：

```json
{"ahead":1,"behind":0}
```

所以 UI 显示 Pull 肯定不符合真实 Git 状态。

---

## 四、Go 源码里的 AheadBehind 算法

我继续看 `sidecar/internal/git/branch.go`。`AheadBehind` 的思路是：

1. 找本地引用 `refs/heads/<branchName>`。
2. 找远程引用 `refs/remotes/origin/<branchName>`。
3. 如果远程引用不存在，就把本地日志都算作 ahead。
4. 如果远程引用存在，就找本地 commit 和远程 commit 的 merge base。
5. 从本地 commit 数到 merge base 得到 ahead。
6. 从远程 commit 数到 merge base 得到 behind。

这个逻辑对当前测试仓库是成立的。为了确认不是算法问题，我直接用 sidecar 协议调用当前源码编译出来的 `sidecar/cmd/sidecar/sidecar.exe`：

```json
{"id":"1","command":"repo.open","payload":{"path":"E:/IntelliGit/sidecar/test/repo"}}
{"id":"2","command":"branch.current"}
{"id":"3","command":"branch.aheadBehind","payload":{"branch":"master"}}
```

返回结果是：

```json
{"id":"3","success":true,"data":{"ahead":1,"behind":0}}
```

这一步说明 Go 代码和新编译出来的 sidecar 都能正确判断 ahead 状态。

---

## 五、运行时 sidecar 旧版本问题

真正的问题出在 Electron 实际启动的二进制上。

开发模式里，`SidecarManager` 启动的是：

```text
resources/intelligit-sidecar.exe
```

而不是：

```text
sidecar/cmd/sidecar/sidecar.exe
```

我用同样的协议请求去调用 `resources/intelligit-sidecar.exe`，它返回：

```json
{"id":"3","success":false,"error":"未知命令: branch.aheadBehind"}
```

这就把整个 bug 串起来了：

```text
前端调用 branch.aheadBehind
  -> resources/intelligit-sidecar.exe 是旧的
  -> 旧 sidecar 不认识这个命令
  -> 调用失败
  -> refreshBranches 把 commitsAhead 设成 0
  -> Toolbar 判断没有待 push commit
  -> 按钮显示 Pull
```

所以这不是按钮显示逻辑的问题，也不是 Git ahead/behind 算法的问题，而是运行时二进制和源码不一致。

---

## 六、重新编译运行时二进制

我先手动重新编译了 sidecar：

```powershell
cd sidecar
go build -o ..\resources\intelligit-sidecar.exe .\cmd\sidecar
```

重新验证 `resources/intelligit-sidecar.exe` 后，它已经能正确返回：

```json
{"id":"3","success":true,"data":{"ahead":1,"behind":0}}
```

这样前端的 `refreshBranches()` 就可以拿到：

```ts
commitsAhead = 1
commitsBehind = 0
```

顶部按钮也就会进入 Push 状态。

---

## 七、TypeScript 构建错误

后面我跑 `npm run build` 时，TypeScript 报了一个未使用变量：

```text
src/renderer/src/MainApp.tsx:412:20 - error TS6133:
'refreshBranches' is declared but its value is never read.
```

当时 `MainApp` 里解构了：

```tsx
const {
  configLoaded,
  loadConfig,
  activeView,
  loading,
  currentRepo,
  refreshStatus,
  refreshBranches
} = useAppStore()
```

但是定时器里实际只用到了：

```tsx
refreshStatus()
```

所以我把 `refreshBranches` 从解构里删掉：

```tsx
const {
  configLoaded,
  loadConfig,
  activeView,
  loading,
  currentRepo,
  refreshStatus
} = useAppStore()
```

之后重新跑：

```powershell
npm run typecheck
```

类型检查通过。

---

## 八、最终修复后的链路

修完以后，Push/Pull 状态链路应该是这样的：

```text
Toolbar
  -> 读取 commitsAhead / commitsBehind
  -> hasCommitsToPush = commitsAhead > 0
  -> refreshBranches()
  -> branch.current
  -> branch.aheadBehind
  -> resources/intelligit-sidecar.exe
  -> Go AheadBehind()
  -> 返回 ahead / behind
```

只要 `resources/intelligit-sidecar.exe` 是最新的，测试仓库 `sidecar/test/repo` 就会返回：

```json
{"ahead":1,"behind":0}
```

按钮就会显示：

```text
Push 1
```

---

## 九、问题排查提醒

这次 bug 最有价值的地方是，它让我意识到跨语言项目里“源码正确”不等于“运行时正确”。

我一开始看到 Go 源码里有 `branch.aheadBehind`，也看到 handler 已经注册，就很容易以为后端没问题。但 Electron 真实运行的是 `resources/intelligit-sidecar.exe`，如果这个二进制没更新，源码里的任何改动都不会生效。

所以以后排查类似问题，我会优先确认三件事：

1. UI 依赖的状态是哪个字段。
2. 这个字段对应的 IPC / sidecar 命令是否成功。
3. Electron 实际运行的 sidecar 二进制是不是最新编译出来的。

这次我后面把 sidecar 编译接入 npm 脚本，也是为了避免同一个问题再次出现。只靠手动记住重新编译太容易漏，构建链路应该主动帮我兜住这个步骤。
