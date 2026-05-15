# IntelliGit 问题 2 整改记录：拆分全局 Zustand Store

本文记录 `walkthrough-2026-5-15.md` 中问题 2 的实际整改过程。

这次处理的目标是：

```text
src/renderer/src/store/useAppStore.ts
```

原问题是这个文件承担了过多职责。它不只是 Zustand store，还混合了配置持久化、Git IPC 调用、远程仓库探测、认证 payload 拼装、Diff / Hunk 操作、Commit Graph、UI 消息和操作后的刷新编排。

这次整改不是简单把一个大文件切成几个小文件，而是重新划清了前端状态、API 边界和业务流程边界。

---

## 1. 原问题确认

整改前，`useAppStore.ts` 同时包含：

```text
配置读取和保存
仓库列表和当前仓库
Git 文件状态
分支和 ahead/behind
commit history
commit graph
Diff 和 Hunk 暂存
Push / Pull / Commit / Checkout / Reset
UI loading / error / successMessage / activeView
window.electronAPI.invokeGit 调用
远程认证 payload 拼装
```

这导致几个直接问题：

```text
状态所有权不清楚
业务流程和状态读写耦合
IPC 调用散落在 store 内部
response.data 需要大量 as 类型断言
operationLoading 只能表示一个字符串，不适合并发操作
后续新增 AI、沙箱、冲突解决等功能会继续堆进同一个 store
```

所以这次整改的核心原则是：

```text
API 边界独立
业务流程独立
状态域独立
组件只订阅自己需要的 store
```

---

## 2. 新增共享 Git 类型

新增文件：

```text
src/shared/types/git.ts
src/shared/types/gitCommands.ts
```

`git.ts` 承载 Git 领域类型：

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

这些类型原本散在 `useAppStore.ts` 里。拆出来以后，store、service 和 API 客户端可以共享同一套类型定义。

`gitCommands.ts` 建立了 Git 命令表：

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
}
```

实际文件里覆盖了当前前端使用到的 repo、staging、commit、branch、remote、merge、diff 等命令。

同时，`SidecarResponse` 被改成泛型：

```ts
export interface SidecarResponse<TData = unknown> {
  id: string
  success: boolean
  data?: TData
  error?: string
}
```

这样后续可以继续强化前后端协议类型。

---

## 3. 新增 API 边界层

新增目录：

```text
src/renderer/src/api/
```

新增文件：

```text
src/renderer/src/api/README.md
src/renderer/src/api/gitClient.ts
src/renderer/src/api/configClient.ts
src/renderer/src/api/filesystemClient.ts
src/renderer/src/api/index.ts
```

这个目录的职责是把 `window.electronAPI` 包成更清晰的客户端。

`gitClient.ts` 是正式业务代码调用 Git IPC 的唯一入口：

```ts
export async function invokeGit<K extends GitCommandName>(
  command: K,
  ...args: GitCommandArgs<K>
): Promise<GitCommandResult<K>>
```

它负责：

```text
约束 command 名称
约束 payload 类型
解包 SidecarResponse
失败时抛出 GitClientError
返回命令对应的 result 类型
```

整改后，正式界面业务代码不再直接调用：

```ts
window.electronAPI.invokeGit(...)
```

只有 `api/gitClient.ts` 和测试面板用的 `useGitStore.ts` 还会直接接触原始 IPC。

---

## 4. 新增业务服务层

新增目录：

```text
src/renderer/src/services/
```

新增文件：

```text
src/renderer/src/services/README.md
src/renderer/src/services/remoteService.ts
src/renderer/src/services/repositoryService.ts
src/renderer/src/services/refreshCoordinator.ts
src/renderer/src/services/gitWorkflowService.ts
```

这个目录承载跨 API、跨 store 的业务流程。

### remoteService.ts

负责远程仓库相关逻辑：

```text
inferRemoteType()
detectAndSyncRemote()
buildRemotePayload()
```

也就是原来 store 里的远程 URL 推断、远程检测、认证 payload 拼装逻辑。

### repositoryService.ts

负责仓库配置和仓库操作的流程：

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

这个 service 只做业务过程，不保存 React 状态。

### refreshCoordinator.ts

负责刷新编排：

```text
clearRepositoryScopedState()
refreshAllLocal()
refreshRemote()
refreshAll()
```

原来的 `refreshAllLocal()`、`refreshRemote()`、`refreshAll()` 从大 store 中移出。

这里还加入了简单的刷新序列判断，避免仓库切换过程中旧刷新结果继续影响新仓库。

### gitWorkflowService.ts

负责用户操作工作流：

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

这些操作本质上会跨多个 store：

```text
执行 Git 命令
更新 operation loading
设置 success/error
刷新 status/history/branch
清理 selected commit 或 diff
异步刷新远程状态
```

因此它们不再属于某一个具体 store，而是放到 service 层统一编排。

---

## 5. 拆分 Zustand Store

新增和调整后的 store：

```text
src/renderer/src/store/README.md
src/renderer/src/store/repositoryStore.ts
src/renderer/src/store/gitStatusStore.ts
src/renderer/src/store/diffStore.ts
src/renderer/src/store/historyStore.ts
src/renderer/src/store/uiStore.ts
src/renderer/src/store/operationStore.ts
src/renderer/src/store/index.ts
```

旧文件已删除：

```text
src/renderer/src/store/useAppStore.ts
```

### repositoryStore.ts

负责：

```text
repos
currentRepo
configLoaded
loadConfig()
addRepo()
createRepo()
cloneRepo()
removeRepo()
switchRepo()
updateRepoSettings()
```

仓库切换时仍保留原来的行为：

```text
设置全局 loading
打开目标仓库
同步远程配置
清空旧仓库状态
先刷新本地状态
再异步刷新远程状态
```

### gitStatusStore.ts

负责：

```text
fileStatuses
currentBranch
branches
remoteBranches
commitsAhead
commitsBehind
refreshStatus()
refreshBranchState()
refreshRemote()
clearGitStatus()
```

它只管理 Git 工作区和分支状态，不再处理 commit、diff 或 UI 消息。

### diffStore.ts

负责：

```text
selectedFilePath
workdirDiff
selectFile()
applyPatch()
unstageHunk()
fetchRawDiff()
clearDiffState()
```

Hunk 操作后会刷新文件状态，并重新加载当前文件 diff。

### historyStore.ts

负责：

```text
commitHistory
allCommitHistory
selectedCommit
selectedCommitFiles
diffCompareResult
refreshHistory()
fetchAllHistory()
selectCommit()
diffTwoCommits()
clearSelectedCommit()
clearHistoryState()
```

Commit Graph 相关状态从 Git 状态中独立出来。

### uiStore.ts

负责：

```text
activeView
loading
error
successMessage
setActiveView()
setLoading()
setError()
showSuccess()
clearError()
clearSuccess()
```

UI 消息不再散落在各个业务 action 中直接维护。

### operationStore.ts

负责操作 loading：

```text
runningOperations
operationLoading
startOperation()
finishOperation()
clearOperations()
withOperation()
```

原来的 `operationLoading: string | null` 只能表示一个操作。现在用 `runningOperations` 支持并发操作，再用 `operationLoading` 保持现有 UI 的兼容展示。

操作 key 也更明确，例如：

```text
repo.switch
staging.add
commit.create
remote.push
remote.pull
branch.checkout
commit.reset
```

状态栏中也把这些 key 映射成中文展示，避免直接显示内部操作名。

---

## 6. 组件迁移

所有正式界面组件都已经从旧的 `useAppStore` 迁出。

### MainApp

文件：

```text
src/renderer/src/app/MainApp.tsx
```

现在分别订阅：

```text
useRepositoryStore -> configLoaded / loadConfig / currentRepo
useUiStore         -> activeView / loading
refreshAllLocal   -> 来自 refreshCoordinator
```

### ActivityRail

订阅：

```text
useUiStore         -> activeView / setActiveView
useGitStatusStore  -> fileStatuses
```

### Toolbar

订阅：

```text
useRepositoryStore -> currentRepo
useGitStatusStore  -> currentBranch / branches / remoteBranches / commitsAhead / commitsBehind
useOperationStore  -> operationLoading
```

调用：

```text
refreshAll()
refreshAllLocal()
push()
pull()
checkoutBranch()
```

### RepoPanel

订阅：

```text
useRepositoryStore -> repos / currentRepo / switchRepo / addRepo / createRepo / cloneRepo / removeRepo
```

文件系统检查改为通过：

```text
api/filesystemClient.ts
repositoryService.isGitRepository()
```

### ChangesView

订阅：

```text
useGitStatusStore  -> fileStatuses
useOperationStore  -> operationLoading
useRepositoryStore -> currentRepo
useDiffStore       -> selectedFilePath / selectFile
```

调用：

```text
addFile()
addAll()
removeFile()
createCommit()
```

### DiffView

订阅：

```text
useDiffStore -> selectedFilePath / workdirDiff
```

### HistoryView

订阅：

```text
useHistoryStore    -> allCommitHistory / selectedCommit / selectedCommitFiles / selectCommit / fetchAllHistory
useGitStatusStore  -> branches / remoteBranches / currentBranch
useRepositoryStore -> currentRepo
useOperationStore  -> operationLoading
```

调用：

```text
checkoutCommit()
resetToCommit()
```

### SettingsView

订阅：

```text
useRepositoryStore -> currentRepo / updateRepoSettings
```

### NotificationBar / StatusBar

分别改为订阅：

```text
NotificationBar -> useUiStore
StatusBar       -> useRepositoryStore / useGitStatusStore / useOperationStore
```

---

## 7. 删除旧入口

旧文件已删除：

```text
src/renderer/src/store/useAppStore.ts
```

没有保留兼容壳。

原因是这次整改目标就是让状态边界明确。如果继续保留 `useAppStore` 作为聚合入口，后续很容易重新把新逻辑塞回全局 store。

现在统一从：

```text
src/renderer/src/store/index.ts
```

导出各个领域 store。

---

## 8. 当前结构

整改后，前端状态和业务结构变成：

```text
shared/types/
  git.ts
  gitCommands.ts
  sidecar.ts

renderer/src/api/
  gitClient.ts
  configClient.ts
  filesystemClient.ts
  README.md

renderer/src/services/
  remoteService.ts
  repositoryService.ts
  refreshCoordinator.ts
  gitWorkflowService.ts
  README.md

renderer/src/store/
  repositoryStore.ts
  gitStatusStore.ts
  diffStore.ts
  historyStore.ts
  uiStore.ts
  operationStore.ts
  useGitStore.ts
  README.md
```

职责关系是：

```text
组件
  -> 订阅 store
  -> 调用 service 中的工作流

store
  -> 保存领域状态
  -> 提供局部 action

service
  -> 编排跨 store / 跨 API 的业务流程

api
  -> 封装 window.electronAPI

shared/types
  -> 定义 Git 数据类型和命令协议类型
```

---

## 9. 验证结果

完整 TypeScript 检查通过：

```bash
npm.cmd run typecheck
```

结果：

```text
typecheck:node 通过
typecheck:web  通过
```

本次改动范围的 ESLint 检查通过：

```bash
npx.cmd eslint src/shared/types/git.ts src/shared/types/gitCommands.ts src/shared/types/sidecar.ts src/renderer/src/api src/renderer/src/services src/renderer/src/store src/renderer/src/app/MainApp.tsx src/renderer/src/layout src/renderer/src/views src/renderer/src/components/DiffView
```

结果：

```text
无 error
无 warning
```

全仓库 lint 仍未通过：

```bash
npm.cmd run lint
```

失败原因不是本次重构引入的新问题，而是原来已经存在的问题：

```text
src/renderer/src/App.tsx
  React hooks 条件调用

其他若干旧文件
  prettier 格式 warning
```

其中 `App.tsx` 的条件 hooks 问题已经在原清单的问题 5 中记录，应该单独处理。

---

## 10. 整改效果

这次整改后，问题 2 的核心风险已经被拆开：

```text
useAppStore.ts 不再作为全局大控制器存在
配置、仓库、Git 状态、Diff、历史、UI、操作 loading 各自有独立 store
IPC 调用收敛到 api/gitClient.ts
远程认证和远程检测进入 remoteService.ts
仓库配置流程进入 repositoryService.ts
commit / push / pull / checkout / reset 等跨域操作进入 gitWorkflowService.ts
刷新流程进入 refreshCoordinator.ts
组件订阅粒度更清楚
```

从后续扩展角度看，新增功能应该按职责落位：

```text
新增 Git 命令
  -> shared/types/gitCommands.ts
  -> api/gitClient.ts 自动获得类型约束

新增状态域
  -> store/ 下新建独立 store

新增跨状态业务流程
  -> services/ 下新增或扩展 workflow service

新增组件
  -> 只订阅自己需要的 store
```

这次整改完成后，问题 2 可以视为已完成第一轮结构性修复。

后续可以继续处理：

```text
问题 5：拆 App.tsx 和 TestPanel，修复 hooks lint 错误
问题 6：继续强化 IPC / Git 命令协议的端到端类型
问题 10：优化自动刷新策略，避免每秒刷新过重
问题 11：把敏感凭据移出普通 RepoConfig
```
