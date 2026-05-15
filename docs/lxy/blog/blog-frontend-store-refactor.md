> 本文为山东大学软件学院创新实训项目博客

# IntelliGit 前端状态层重构：把一个全局 Store 拆成清晰的状态边界

这次做的是 IntelliGit 前端状态层的一次结构性重构。

在前一轮前端主界面拆分中，我们已经把原来庞大的 `MainApp.tsx` 拆成了 `app/`、`layout/`、`views/`、`components/` 和 `utils/` 几个目录。这样一来，界面结构已经比最早清楚很多：应用装配、工作台外壳、业务视图和复用组件都有了自己的位置。

但主界面拆开以后，另一个问题就变得更明显了：`useAppStore.ts` 仍然是整个前端状态和业务逻辑的“总控制器”。

它不只是一个 Zustand store，而是同时承担了太多角色：

```text
仓库配置管理
Git 状态管理
Diff 状态管理
Commit Graph 状态管理
UI 消息管理
Push / Pull / Commit / Checkout / Reset 工作流
远程仓库探测
认证 payload 拼装
window.electronAPI.invokeGit 调用
操作后的刷新编排
```

所以这次重构的目标不是简单地“把一个大文件切成几个小文件”，而是重新划清前端状态层的职责边界。

---

## 一、为什么 `useAppStore.ts` 必须拆

原来的 `useAppStore.ts` 有接近一千行。单看行数，它当然已经偏长，但真正的问题还是职责混杂。

比如仓库配置相关逻辑在里面：

```ts
loadConfig()
addRepo()
createRepo()
cloneRepo()
removeRepo()
switchRepo()
updateRepoSettings()
```

Git 工作区相关逻辑也在里面：

```ts
refreshStatus()
refreshHistory()
refreshAllLocal()
refreshRemote()
refreshAll()
```

Diff 和 Hunk 相关逻辑也在里面：

```ts
selectFile()
applyPatch()
unstageHunk()
fetchRawDiff()
```

Commit Graph 相关逻辑也在里面：

```ts
fetchAllHistory()
selectCommit()
diffTwoCommits()
checkoutCommit()
resetToCommit()
```

甚至 UI 状态也在同一个 store 中：

```ts
loading
operationLoading
error
successMessage
activeView
```

这带来的问题是：任何一个业务 action 都可以读写几乎所有状态。

例如创建一次 commit，表面上只是提交代码，但实际会牵扯：

```text
读取当前仓库配置
拼装 authorName / authorEmail
调用 commit.create
设置 successMessage
清空 selectedCommit
刷新 status
刷新 history
刷新 branch
刷新 ahead/behind
异步刷新 remote
异步刷新 all history
修改 operationLoading
```

这类逻辑如果都堆在 store 里，store 就会越来越像第二个 `MainApp.tsx`。短期写起来方便，长期会让每次修改都变得不确定：改一个 action 时，很难第一眼判断它会影响哪些状态区域。

所以这次重构的核心判断是：

```text
store 不应该承担所有业务流程。

store 应该保存状态和提供局部 action；
跨多个状态域的业务流程，应该放到 service 层；
IPC 调用应该收敛到 api 层；
共享协议类型应该从 store 中抽出来。
```

---

## 二、先把 Git 领域类型从 store 里拿出来

这次第一步，是新增共享类型文件：

```text
src/shared/types/git.ts
src/shared/types/gitCommands.ts
```

原来这些类型都写在 `useAppStore.ts` 里：

```ts
export interface FileStatusInfo {
  path: string
  staging: string
  worktree: string
}

export interface CommitRecord {
  hash: string
  shortHash: string
  author: string
  authorEmail: string
  date: string
  message: string
  parentHashes: string[]
  refs?: string[]
}
```

这些并不是某个 store 私有的类型，而是 IntelliGit 前端和 Sidecar 之间共享的 Git 领域数据。它们更适合放在 `shared/types` 里。

拆出来以后，`git.ts` 负责描述 Git 数据结构：

```text
FileStatusInfo
CommitRecord
BranchInfo
DiffEntry
RemoteInfo
PatchDetail
FilePatchInfo
ChunkInfo
MergeConflictInfo
MergeStatusResult
ResetMode
```

这一步看起来只是移动类型，但意义比较重要：状态层不再是领域模型的来源。后续不管是 store、service、api，还是组件，都可以引用同一套 Git 类型。

---

## 三、建立 Git 命令表，减少随手 `as`

原来的 Git IPC 调用是这样的：

```ts
const response = await window.electronAPI.invokeGit('branch.list')

if (response.success) {
  set({ branches: (response.data as BranchInfo[]) || [] })
}
```

这种写法有一个隐含问题：TypeScript 并不知道 `'branch.list'` 应该返回什么。每次都要靠人工写 `as BranchInfo[]` 告诉编译器“相信我”。

这次新增了：

```text
src/shared/types/gitCommands.ts
```

里面建立了一张命令表：

```ts
export type GitCommandMap = {
  'repo.open': {
    payload: { path: string }
    result: { path: string }
  }
  'staging.status': {
    payload: undefined
    result: FileStatusInfo[]
  }
  'branch.current': {
    payload: undefined
    result: { branch: string }
  }
  'diff.workdir': {
    payload: { path?: string }
    result: PatchDetail
  }
}
```

实际文件中覆盖了当前用到的 repo、staging、commit、branch、remote、merge、diff 等命令。

然后再定义几个辅助类型：

```ts
export type GitCommandName = keyof GitCommandMap
export type GitCommandPayload<K extends GitCommandName> = GitCommandMap[K]['payload']
export type GitCommandResult<K extends GitCommandName> = GitCommandMap[K]['result']
```

这样前端调用 Git 命令时，命令名、payload 和返回值就能对应起来。

它不能替代 Go 端的类型校验，但至少可以让 TypeScript 在前端侧提前发现一部分问题。比如给 `branch.current` 传 payload，或者忘记给 `repo.open` 传 path，都能更早暴露。

---

## 四、新增 API 层，把 `window.electronAPI` 收起来

这次新增了一个目录：

```text
src/renderer/src/api/
```

里面有：

```text
gitClient.ts
configClient.ts
filesystemClient.ts
index.ts
README.md
```

这个目录的定位很明确：它是 Renderer 侧和 Electron preload API 之间的边界。

正式业务代码不应该到处直接写：

```ts
window.electronAPI.invokeGit(...)
window.electronAPI.loadConfig()
window.electronAPI.saveConfig(...)
window.electronAPI.checkDirExists(...)
```

因为这样会让系统调用散落在各个组件和 store 里。后续如果 IPC 协议变化，或者要统一处理错误，就会很难收口。

现在 Git 调用统一经过：

```ts
export async function invokeGit<K extends GitCommandName>(
  command: K,
  ...args: GitCommandArgs<K>
): Promise<GitCommandResult<K>> {
  const payload = args[0] as Record<string, unknown> | undefined
  const response = await window.electronAPI.invokeGit(command, payload)

  if (!response.success) {
    throw new GitClientError(command, response.error || `Git 命令执行失败: ${command}`)
  }

  return response.data as GitCommandResult<K>
}
```

这个客户端做了几件事：

```text
约束命令名
约束 payload
解包 SidecarResponse
失败时抛出 GitClientError
返回命令对应的 result 类型
```

这一步以后，正式界面里直接调用 `window.electronAPI.invokeGit` 的地方被收敛了。测试面板用的 `useGitStore.ts` 仍然保留原始命令调用能力，因为它本来就是为了调试任意命令。

---

## 五、新增 services 层，把业务流程从 store 里拿出来

只拆 store 文件还不够。因为很多逻辑本质上不是“某个状态自己的 action”，而是跨多个状态域的业务流程。

所以这次新增：

```text
src/renderer/src/services/
```

里面有：

```text
remoteService.ts
repositoryService.ts
refreshCoordinator.ts
gitWorkflowService.ts
README.md
```

### 1. remoteService：远程仓库和认证 payload

原来 `useAppStore.ts` 里有这些逻辑：

```text
inferRemoteType()
detectAndSyncRemote()
remotePayload()
```

它们都和远程仓库配置有关，不应该挂在全局 store 里。

现在放到：

```text
src/renderer/src/services/remoteService.ts
```

它负责：

```text
根据远程 URL 推断 remoteType
读取 Git 仓库中的 origin 配置
判断远程地址是否变化
在地址变化时清空旧认证信息
根据当前仓库配置拼装 push / pull / fetch payload
```

比如远程 payload 现在由：

```ts
buildRemotePayload(repo)
```

统一生成。后续如果凭据不再存在 `RepoConfig` 里，而是迁到系统 keychain，也可以集中改这里。

### 2. repositoryService：仓库配置和仓库操作流程

仓库相关的业务过程放到：

```text
src/renderer/src/services/repositoryService.ts
```

它负责：

```text
loadRepositoryConfig()
persistConfig()
addExistingRepository()
createRepository()
cloneRepository()
switchRepository()
updateRepositorySettings()
isGitRepository()
```

这层不保存 React 状态，只负责把配置读写、Git 命令调用和远程检测这些过程组织起来。

比如加载配置时，会做这些事：

```text
读取本地 AppConfig
找到 currentRepo
尝试 repo.open
检测 origin 远程仓库
必要时同步 remoteType / remoteUrl
必要时重新持久化配置
返回 repos 和 currentRepo
```

repository store 只需要接收结果并更新状态，不再直接知道这些细节。

### 3. refreshCoordinator：统一管理刷新

原来的刷新逻辑也是大 store 里的一个重点区域：

```text
refreshStatus()
refreshHistory()
refreshAllLocal()
refreshRemote()
refreshAll()
```

这次把跨状态刷新编排放到：

```text
src/renderer/src/services/refreshCoordinator.ts
```

它负责：

```text
clearRepositoryScopedState()
refreshAllLocal()
refreshRemote()
refreshAll()
```

其中 `refreshAllLocal()` 会组合：

```text
gitStatusStore.refreshStatus()
historyStore.refreshHistory()
gitStatusStore.refreshBranchState()
```

`refreshRemote()` 会调用：

```text
gitStatusStore.refreshRemote(currentRepo)
```

这样刷新策略就从单个 store 中独立出来了。

这次还加了一个简单的刷新序列判断：

```ts
let refreshSequence = 0
```

它的作用是避免仓库切换过程中，旧仓库的刷新结果继续影响新仓库。这个问题在当前项目里还没有完全爆发，但从结构上提前收口会更稳。

### 4. gitWorkflowService：用户操作工作流

最重要的一层是：

```text
src/renderer/src/services/gitWorkflowService.ts
```

它承载用户操作：

```text
addFile()
addAll()
removeFile()
createCommit()
push()
pull()
checkoutBranch()
checkoutCommit()
resetToCommit()
```

这些函数都不是单纯的状态更新。以 `push()` 为例，它会：

```text
读取 currentRepo
根据远程配置生成认证 payload
调用 remote.push
显示 Push 成功消息
刷新本地状态
异步刷新远程状态
失败时写入 UI error
维护 operation loading
```

这些动作横跨 repository、git status、history、ui、operation 多个状态域。所以它不应该属于某一个 store，而应该作为 workflow service 存在。

这样拆完以后，store 更像状态容器，service 更像业务流程编排层。

---

## 六、真正拆分 Zustand Store

这次新增和整理后的 store 结构是：

```text
src/renderer/src/store/
  repositoryStore.ts
  gitStatusStore.ts
  diffStore.ts
  historyStore.ts
  uiStore.ts
  operationStore.ts
  useGitStore.ts
  index.ts
  README.md
```

旧的：

```text
src/renderer/src/store/useAppStore.ts
```

已经删除。

### repositoryStore：仓库状态

`repositoryStore.ts` 管：

```text
repos
currentRepo
configLoaded
```

以及仓库相关 action：

```text
loadConfig()
addRepo()
createRepo()
cloneRepo()
removeRepo()
switchRepo()
updateRepoSettings()
```

这里仍然保留原来的用户体验：切换仓库时，会先进入 loading，打开仓库，清空旧仓库状态，先刷新本地状态，再异步刷新远程状态。

不同的是，具体细节不再全部写在 store 里，而是委托给 `repositoryService` 和 `refreshCoordinator`。

### gitStatusStore：工作区和分支状态

`gitStatusStore.ts` 管：

```text
fileStatuses
currentBranch
branches
remoteBranches
commitsAhead
commitsBehind
```

以及：

```text
refreshStatus()
refreshBranchState()
refreshRemote()
clearGitStatus()
```

它只关心 Git 状态，不再关心 commit graph、diff 或 UI 消息。

### diffStore：文件 Diff 和 Hunk

`diffStore.ts` 管：

```text
selectedFilePath
workdirDiff
```

以及：

```text
selectFile()
applyPatch()
unstageHunk()
fetchRawDiff()
clearDiffState()
```

Hunk 暂存后，会刷新文件状态，并重新加载当前文件 diff。这类局部联动仍然留在 diff store 中，因为它和当前 diff 状态高度相关。

### historyStore：提交历史和 Commit Graph

`historyStore.ts` 管：

```text
commitHistory
allCommitHistory
selectedCommit
selectedCommitFiles
diffCompareResult
```

以及：

```text
refreshHistory()
fetchAllHistory()
selectCommit()
diffTwoCommits()
clearSelectedCommit()
clearHistoryState()
```

这样历史视图和工作区状态不再挤在同一个 store 里。

### uiStore：全局 UI 状态

`uiStore.ts` 管：

```text
activeView
loading
error
successMessage
```

以及：

```text
setActiveView()
setLoading()
setError()
showSuccess()
clearError()
clearSuccess()
```

成功消息的自动清理也集中到了这里，不再散落在各个 action 里反复写 `setTimeout`。

### operationStore：操作 loading 状态

原来只有：

```ts
operationLoading: string | null
```

现在变成：

```text
runningOperations
operationLoading
startOperation()
finishOperation()
withOperation()
```

操作 key 也更明确：

```text
repo.switch
staging.add
staging.addAll
staging.remove
commit.create
remote.push
remote.pull
branch.checkout
commit.reset
```

这让状态层更适合处理并发操作。比如后台刷新和用户操作不必再争抢一个模糊的 loading 字符串。

---

## 七、组件如何迁移

这次重构后，正式界面组件全部从 `useAppStore` 迁出。

比如 `MainApp` 原来订阅一个 store：

```ts
const configLoaded = useAppStore((state) => state.configLoaded)
const loadConfig = useAppStore((state) => state.loadConfig)
const activeView = useAppStore((state) => state.activeView)
const loading = useAppStore((state) => state.loading)
const currentRepo = useAppStore((state) => state.currentRepo)
const refreshAllLocal = useAppStore((state) => state.refreshAllLocal)
```

现在变成按领域订阅：

```ts
const configLoaded = useRepositoryStore((state) => state.configLoaded)
const loadConfig = useRepositoryStore((state) => state.loadConfig)
const currentRepo = useRepositoryStore((state) => state.currentRepo)
const activeView = useUiStore((state) => state.activeView)
const loading = useUiStore((state) => state.loading)
```

`refreshAllLocal` 则来自：

```text
services/refreshCoordinator.ts
```

再比如 `ChangesView`，现在的状态来源更清楚：

```text
useGitStatusStore  -> fileStatuses
useOperationStore  -> operationLoading
useRepositoryStore -> currentRepo
useDiffStore       -> selectedFilePath / selectFile
```

用户操作则来自 workflow service：

```text
addFile()
addAll()
removeFile()
createCommit()
```

这让组件代码更容易读：组件订阅状态，service 执行业务动作，中间不再有一个“什么都知道”的全局 store。

---

## 八、为什么没有保留 `useAppStore` 兼容壳

这次直接删除了：

```text
src/renderer/src/store/useAppStore.ts
```

没有保留类似这样的聚合入口：

```ts
export const useAppStore = ...
```

原因是，如果继续保留这个入口，后续很容易重新把新功能塞回全局 store。这样短期迁移轻松一点，但长期会把刚刚拆出来的边界重新抹平。

现在统一从：

```text
src/renderer/src/store/index.ts
```

导出明确的 store：

```ts
export { useRepositoryStore } from './repositoryStore'
export { useGitStatusStore } from './gitStatusStore'
export { useDiffStore } from './diffStore'
export { useHistoryStore } from './historyStore'
export { useUiStore } from './uiStore'
export { useOperationStore } from './operationStore'
```

这比保留一个万能 store 更“硬”一点，但边界也更不容易退化。

---

## 九、补 README，让目录知道自己的职责

这次新建目录时，也补了 README：

```text
src/renderer/src/api/README.md
src/renderer/src/services/README.md
src/renderer/src/store/README.md
```

比如 `store/README.md` 里明确写了：

```text
repositoryStore.ts -> 仓库列表、当前仓库、配置加载状态和仓库配置操作
gitStatusStore.ts  -> 工作区文件状态、分支列表、当前分支、ahead/behind
diffStore.ts       -> 当前选中文件、工作区 diff、hunk 暂存相关局部状态
historyStore.ts    -> commit history、commit graph、选中 commit 和 commit diff
uiStore.ts         -> 当前视图、全局 loading、错误和成功消息
operationStore.ts  -> 用户操作的并发 loading 状态
```

我觉得这类 README 在团队项目里很有用。目录结构能告诉人“这里大概是什么”，README 能进一步告诉人“这里应该放什么、不应该放什么”。

---

## 十、验证结果

重构完成后，先跑了完整 TypeScript 检查：

```bash
npm.cmd run typecheck
```

结果通过：

```text
typecheck:node 通过
typecheck:web  通过
```

然后针对这次改动范围跑 ESLint：

```bash
npx.cmd eslint src/shared/types/git.ts src/shared/types/gitCommands.ts src/shared/types/sidecar.ts src/renderer/src/api src/renderer/src/services src/renderer/src/store src/renderer/src/app/MainApp.tsx src/renderer/src/layout src/renderer/src/views src/renderer/src/components/DiffView
```

结果也是通过：

```text
无 error
无 warning
```

全仓库 lint 目前仍然没有通过：

```bash
npm.cmd run lint
```

但失败原因不是这次重构引入的新问题，而是项目里原本就存在的两个问题：

```text
src/renderer/src/App.tsx
  测试面板 hooks 条件调用

其他旧文件
  一批 prettier 格式 warning
```

其中 `App.tsx` 的问题已经在结构体检清单的问题 5 里记录，后续应该单独拆 `TestPanel.tsx` 来解决。

---

## 十一、这次重构之后的结构

现在前端状态层大致变成：

```text
shared/types/
  git.ts
  gitCommands.ts
  sidecar.ts

renderer/src/api/
  gitClient.ts
  configClient.ts
  filesystemClient.ts

renderer/src/services/
  remoteService.ts
  repositoryService.ts
  refreshCoordinator.ts
  gitWorkflowService.ts

renderer/src/store/
  repositoryStore.ts
  gitStatusStore.ts
  diffStore.ts
  historyStore.ts
  uiStore.ts
  operationStore.ts
```

它们之间的关系可以理解成：

```text
组件
  -> 订阅 store
  -> 调用 service

store
  -> 保存状态
  -> 提供局部 action

service
  -> 编排跨 store / 跨 API 的业务流程

api
  -> 封装 window.electronAPI

shared/types
  -> 定义 Git 数据类型和命令协议
```

这样以后新增功能时，就能更明确地选择落点。

比如新增一个 Git 命令：

```text
先补 GitCommandMap
再通过 invokeGit 调用
```

新增一个状态域：

```text
在 store/ 下新增独立 store
```

新增一个跨状态流程：

```text
放到 services/ 下，而不是塞进某个 store
```

---

## 十二、总结

这次重构最大的变化，是把 `useAppStore.ts` 从“全局大控制器”拆成了更清晰的层次。

原来的写法很适合早期快速推进功能。因为那时候最重要的是打通 Git 状态、Diff、提交、Push / Pull、历史图这些链路。所有东西放在一个 store 里，确实能快速跑起来。

但当功能越来越多以后，全局 store 就会开始反过来限制项目。每一个新功能都会问同一个问题：是不是继续塞进 `useAppStore.ts`？

这次整改以后，答案变清楚了：

```text
状态放 store
流程放 service
系统调用放 api
协议类型放 shared/types
```

它不是为了追求目录数量，而是为了让项目后续继续长功能时，不再把所有东西堆到同一个文件里。

对 IntelliGit 来说，这一步是从“功能跑通”走向“结构可维护”的关键整理。后面无论是继续做 AI commit、智能暂存、冲突解决、沙箱验证，还是优化刷新策略、强化 IPC 类型，都有了更清楚的落点。

这次之后，问题 2 可以算是完成了第一轮结构性修复。接下来比较自然的下一步，是继续处理 `App.tsx` 测试面板条件 hooks 问题，以及自动刷新过重和凭据存储这两个更深层的结构问题。
