> 本文为山东大学软件学院创新实训项目博客

# IntelliGit 前端订阅边界重构

这次做的是 IntelliGit 前端状态订阅方式的一次继续整理。

在前两轮重构中，我们已经分别完成了两件很重要的事情：第一，把原来庞大的 `MainApp.tsx` 拆成了 `app/`、`layout/`、`views/`、`components/` 等更清楚的目录；第二，把原来的全局 `useAppStore.ts` 拆成了多个按状态所有权划分的 Zustand store。到这个阶段，前端结构已经比最早清楚很多。

但这并不意味着状态层的问题已经完全结束。

拆完 store 以后，我重新检查了一遍组件的订阅方式，发现一个新的问题逐渐浮出来：虽然旧的 `useAppStore()` 已经不存在了，组件也基本都改成了 selector 订阅，但很多 UI 文件仍然直接 import store，并在组件内部到处写：

```tsx
const currentRepo = useRepositoryStore((state) => state.currentRepo)
const fileStatuses = useGitStatusStore((state) => state.fileStatuses)
const operationLoading = useOperationStore((state) => state.operationLoading)
```

这比完整订阅 `useAppStore()` 已经好很多，但它仍然暴露出一个结构问题：组件还知道太多 store 的内部字段。

这篇博客就记录一下，我是怎么把“组件直接订阅 store”的方式继续向前推进，整理成 selector 层、view model 层、service workflow 层三段边界的。

---

## 一、问题已经变化了：不是 `useAppStore()`，而是订阅契约不稳定

最早结构体检文档里，问题 3 的表述是：

```text
MainApp.tsx 多处直接调用 useAppStore()
没有使用 selector 精确订阅所需字段
```

这个判断在当时是准确的。因为原来的 `useAppStore.ts` 是一个大而全的全局 store，组件如果直接调用 `useAppStore()`，就等于订阅整个状态对象。任何字段变化，都可能让组件重新渲染。

但在问题 1 和问题 2 完成之后，项目已经发生变化：

```text
src/renderer/src/MainApp.tsx
  -> 只剩兼容导出

src/renderer/src/app/MainApp.tsx
  -> 实际应用装配

src/renderer/src/store/
  -> 已经拆成 repositoryStore、gitStatusStore、diffStore、historyStore、uiStore、operationStore
```

也就是说，旧的 `useAppStore()` 问题已经被前面的重构解决了。

新的问题更细，也更容易被忽略：组件虽然使用了 selector，但 selector 是散落在组件内部的；组件仍然直接知道每个 store 里有哪些字段，也知道多个 store 之间如何组合。

例如 `ChangesView` 里既订阅 Git 文件状态，又订阅当前仓库，又订阅 Diff 选中文件，还要订阅 operation loading：

```tsx
const fileStatuses = useGitStatusStore((state) => state.fileStatuses)
const operationLoading = useOperationStore((state) => state.operationLoading)
const currentRepo = useRepositoryStore((state) => state.currentRepo)
const selectedFilePath = useDiffStore((state) => state.selectedFilePath)
const selectFile = useDiffStore((state) => state.selectFile)
```

这类写法短期并不会立刻出 bug，但它带来的维护压力很明显：

```text
组件需要知道多个 store 的字段结构
派生数据在组件里临时计算
业务 action 和 UI 状态混在一起
后续如果 store 字段调整，需要改很多组件
```

所以这次重构的目标，不只是“把 selector 写得更漂亮”，而是建立一个更稳定的订阅契约。

我的判断是：

```text
组件不应该直接认识 store。

组件应该认识的是自己要渲染的页面模型；
store selector 应该是状态层的读取协议；
跨 store 的组合应该放在 view model；
跨业务域的流程应该放在 service。
```

---

## 二、新增 selector 层：把“怎么读状态”集中起来

这次第一步，是新增一个明确的 selector 目录：

```text
src/renderer/src/store/selectors/
```

这个目录按状态域拆分：

```text
repositorySelectors.ts
gitStatusSelectors.ts
diffSelectors.ts
historySelectors.ts
uiSelectors.ts
operationSelectors.ts
gitCommandSelectors.ts
index.ts
```

这样一来，组件或者 view model 不再直接写匿名 selector：

```tsx
useGitStatusStore((state) => state.fileStatuses)
```

而是使用有名字的 selector：

```tsx
useGitStatusStore(selectFileStatuses)
```

例如 Git 状态相关 selector 现在是这样：

```ts
import type { BranchInfo } from '../../../../shared/types'
import type { GitStatusStoreState } from '../gitStatusStore'
import { countChangedFiles } from '../../utils/fileStatus'

export const selectFileStatuses = (
  state: GitStatusStoreState
): GitStatusStoreState['fileStatuses'] => state.fileStatuses

export const selectChangeCount = (state: GitStatusStoreState): number =>
  countChangedFiles(state.fileStatuses)

export const selectCurrentBranch = (state: GitStatusStoreState): string => state.currentBranch

export const selectBranches = (state: GitStatusStoreState): BranchInfo[] => state.branches

export const selectRemoteBranches = (state: GitStatusStoreState): BranchInfo[] =>
  state.remoteBranches

export const selectCommitsAhead = (state: GitStatusStoreState): number => state.commitsAhead

export const selectCommitsBehind = (state: GitStatusStoreState): number => state.commitsBehind
```

这一步的意义不只是减少重复代码。

更重要的是，selector 变成了一层“读取协议”。以后如果 `gitStatusStore` 内部字段发生调整，只要 selector 的外部语义不变，大部分 UI 层就不用跟着动。

我把这件事理解成：以前组件是在直接摸 store 的内部结构；现在组件或者 view model 是通过一组命名好的读取接口拿状态。

---

## 三、新增 viewModels 层：让组件消费页面模型

只有 selector 还不够。因为真实页面通常不是只读一个字段，而是会组合多个 store 的状态。

比如 `ChangesView` 需要的数据包括：

```text
当前仓库
当前选中文件
选择文件的 action
已暂存文件列表
未暂存文件列表
是否有操作正在执行
当前是否正在 commit
```

这些数据分散在 `repositoryStore`、`gitStatusStore`、`diffStore`、`operationStore` 里。如果让组件自己去组合，那么组件仍然会知道太多状态层细节。

所以这次新增了：

```text
src/renderer/src/viewModels/
```

这个目录的定位是 UI 订阅适配层。它把多个 selector、派生数据和业务 service action 组合成组件真正需要的 model。

比如 `useChangesViewModel.ts`：

```ts
import { useMemo } from 'react'

import type { FileStatusInfo, RepoConfig } from '../../../shared/types'
import { useDiffStore, useGitStatusStore, useOperationStore, useRepositoryStore } from '../store'
import {
  selectCurrentRepo,
  selectFileStatuses,
  selectOperationLoading,
  selectSelectedFilePath,
  selectSelectFile
} from '../store/selectors'
import { splitFileStatuses } from '../utils/fileStatus'

interface ChangesViewModel {
  currentRepo: RepoConfig | null
  selectedFilePath: string | null
  selectFile: (path: string) => Promise<void>
  staged: FileStatusInfo[]
  unstaged: FileStatusInfo[]
  isBusy: boolean
  isCommitRunning: boolean
}

export function useChangesViewModel(): ChangesViewModel {
  const fileStatuses = useGitStatusStore(selectFileStatuses)
  const operationLoading = useOperationStore(selectOperationLoading)
  const currentRepo = useRepositoryStore(selectCurrentRepo)
  const selectedFilePath = useDiffStore(selectSelectedFilePath)
  const selectFile = useDiffStore(selectSelectFile)
  const { staged, unstaged } = useMemo(() => splitFileStatuses(fileStatuses), [fileStatuses])

  return {
    currentRepo,
    selectedFilePath,
    selectFile,
    staged,
    unstaged,
    isBusy: Boolean(operationLoading),
    isCommitRunning: operationLoading === 'commit.create'
  }
}
```

这样 `ChangesView` 就不用知道文件状态是从哪个 store 来的，也不用知道暂存区和未暂存区怎么拆。它只需要消费：

```tsx
const { currentRepo, selectedFilePath, selectFile, staged, unstaged, isBusy, isCommitRunning } =
  useChangesViewModel()
```

我觉得 view model 层最大的价值是，它把“状态怎么组合”从 JSX 中拿出来了。组件开始更像一个单纯的渲染函数，而不是状态读取、数据计算、业务调用、界面渲染的混合体。

---

## 四、把派生数据从组件里拿出来

这次重构还处理了一个容易被低估的问题：派生数据的位置。

以前很多派生逻辑直接写在组件里。例如文件状态拆分：

```tsx
const staged = fileStatuses.filter((file) => file.staging !== ' ' && file.staging !== '?')
const unstaged = fileStatuses.filter((file) => file.worktree !== ' ' || file.staging === '?')
```

活动栏里的变更数量也是临时算的：

```tsx
const changeCount = fileStatuses.filter(
  (file) => file.staging !== ' ' || file.worktree !== ' '
).length
```

这些逻辑不复杂，但它们有一个共同问题：规则散落在组件里。如果后续 Git 状态编码需要调整，比如新增 rename、conflict、ignored 等状态，就要在多个组件里找规则。

所以我把这类逻辑收敛到 `utils/fileStatus.ts`：

```ts
export function isStagedFile(file: FileStatusInfo): boolean {
  return file.staging !== ' ' && file.staging !== '?'
}

export function isUnstagedFile(file: FileStatusInfo): boolean {
  return file.worktree !== ' ' || file.staging === '?'
}

export function hasWorkingTreeChange(file: FileStatusInfo): boolean {
  return file.staging !== ' ' || file.worktree !== ' '
}

export function splitFileStatuses(fileStatuses: FileStatusInfo[]): {
  staged: FileStatusInfo[]
  unstaged: FileStatusInfo[]
} {
  return {
    staged: fileStatuses.filter(isStagedFile),
    unstaged: fileStatuses.filter(isUnstagedFile)
  }
}

export function countChangedFiles(fileStatuses: FileStatusInfo[]): number {
  return fileStatuses.filter(hasWorkingTreeChange).length
}
```

类似地，分支选择器里的本地分支和远程分支合并逻辑，被移动到了：

```text
src/renderer/src/utils/branchOptions.ts
```

Commit Graph 的 lane map 计算，被移动到了：

```text
src/renderer/src/utils/commitGraph.ts
```

这一步对性能和可维护性都有帮助。组件不再每次渲染时随手写一段计算规则；view model 可以通过 `useMemo` 包住复杂派生；规则本身也有了更明确的复用位置。

---

## 五、继续拆视图：让局部状态待在局部组件里

在迁移订阅方式的同时，我也顺手把两个比较重的视图继续拆开了。

`ChangesView` 原来同时负责：

```text
已暂存文件列表
未暂存文件列表
Diff 面板
提交输入框
沙箱验证开关
提交按钮状态
```

这会导致一个问题：提交输入框里的本地状态变化，也会和整个变更视图待在同一个组件里。虽然 React 可以处理这种渲染，但从结构上看并不清爽。

这次拆成了：

```text
src/renderer/src/views/ChangesView/index.tsx
src/renderer/src/views/ChangesView/FileSection.tsx
src/renderer/src/views/ChangesView/DiffPane.tsx
src/renderer/src/views/ChangesView/CommitPanel.tsx
```

`index.tsx` 现在更像页面装配：

```tsx
<FileSection
  title="已暂存"
  emptyDescription="无暂存文件"
  files={staged}
  selectedFilePath={selectedFilePath}
  actionTitle="取消暂存"
  actionIcon={<CloseOutlined />}
  statusCode={(file) => file.staging}
  onSelectFile={selectFile}
  onFileAction={removeFile}
/>

<DiffPane selectedFilePath={selectedFilePath} />

<CommitPanel
  stagedCount={staged.length}
  isBusy={isBusy}
  isCommitRunning={isCommitRunning}
/>
```

提交输入框的状态则留在 `CommitPanel` 里：

```tsx
function CommitPanel({ stagedCount, isBusy, isCommitRunning }: CommitPanelProps): JSX.Element {
  const [commitMsg, setCommitMsg] = useState('')
  const [runSandbox, setRunSandbox] = useState(false)

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) return
    await createCommit(commitMsg.trim())
    setCommitMsg('')
  }, [commitMsg])

  // 省略渲染
}
```

这样拆完以后，提交面板自己的输入状态、沙箱开关状态就不会污染整个 `ChangesView`。

`HistoryView` 也做了类似处理。原来它同时负责：

```text
分支搜索
Commit Graph 绘制
Commit 详情
Reset 模式选择
Reset 二次确认
自动选择 HEAD commit
```

这次拆成：

```text
src/renderer/src/views/HistoryView/index.tsx
src/renderer/src/views/HistoryView/BranchPanel.tsx
src/renderer/src/views/HistoryView/CommitGraph.tsx
src/renderer/src/views/HistoryView/CommitDetail.tsx
```

其中：

```text
BranchPanel
  -> 只管分支搜索和分支列表

CommitGraph
  -> 只管提交图列表和 lane 渲染

CommitDetail
  -> 只管提交详情、Checkout、Reset 确认
```

这次拆视图和订阅重构是配套的。view model 提供页面模型，子组件再根据自己的职责消费 props。这样状态来源和渲染结构都更清楚。

---

## 六、把 repository workflow 从 store 中移走

在前一轮 store 拆分后，`repositoryStore.ts` 虽然已经从全局 store 中独立出来，但它仍然承担了不少业务 workflow。

比如加载配置时，它不仅要设置仓库列表，还要触发刷新：

```text
load config
set repos/currentRepo/configLoaded
如果有 currentRepo，则 refreshAll
```

切换仓库时，它还要：

```text
设置全局 loading
清空错误
调用 switchRepository
更新仓库状态
清理仓库作用域状态
刷新本地状态
异步刷新远程状态
处理错误消息
关闭 loading
```

这些流程已经超出了“store 保存状态”的范围。所以这次新增了：

```text
src/renderer/src/services/repositoryWorkflowService.ts
```

`repositoryStore.ts` 被收窄为状态容器：

```ts
export interface RepositoryStoreState {
  repos: RepoConfig[]
  currentRepo: RepoConfig | null
  configLoaded: boolean
  setRepositoryState: (state: Partial<RepositoryStateData>) => void
}

export const useRepositoryStore = create<RepositoryStoreState>((set) => ({
  repos: [],
  currentRepo: null,
  configLoaded: false,

  setRepositoryState: (state) => set(state)
}))
```

真正的仓库流程则放到 service：

```ts
export async function switchRepo(path: string): Promise<void> {
  const { repos } = useRepositoryStore.getState()
  useUiStore.getState().setLoading(true)
  useUiStore.getState().setError(null)

  try {
    await withOperation('repo.switch', async () => {
      const result = await switchRepository(path, repos)
      if (!result.success || !result.currentRepo) {
        useUiStore.getState().setError(result.error || '切换仓库失败')
        return
      }

      setRepositoryState({ repos: result.repos, currentRepo: result.currentRepo })
      clearRepositoryScopedState()
      await refreshAllLocal()
      refreshRemote().catch((err) =>
        console.error('[repositoryWorkflowService] switchRepo 异步远程刷新失败:', err)
      )
    })
  } catch (err) {
    useUiStore.getState().setError(`切换仓库失败: ${errorMessage(err)}`)
  } finally {
    useUiStore.getState().setLoading(false)
  }
}
```

这个改动非常关键。它让 store 的职责重新变得单纯：

```text
store 负责状态所有权
repositoryService 负责仓库业务过程
repositoryWorkflowService 负责跨 store 编排
```

我觉得这是比单纯拆文件更重要的地方。因为如果 workflow 还继续留在 store 里，store 很快又会变成另一个“总控制器”。

---

## 七、把 hunk 操作从 diffStore 移到 gitWorkflowService

类似的问题也存在于 `diffStore.ts`。

Diff store 本来应该只负责：

```text
当前选中文件
当前文件 diff
清空 diff 状态
读取某个文件 diff
```

但之前 hunk 暂存和取消暂存也在里面。问题是 hunk 操作并不是单纯的 Diff 状态变化。它会牵扯：

```text
调用 staging.applyPatch 或 staging.unstageHunk
刷新 Git 文件状态
重新读取当前文件 diff
设置 UI 错误消息
设置 operation loading
```

这些明显是跨状态域 workflow。

所以这次把：

```text
applyPatch()
unstageHunk()
```

从 `diffStore.ts` 移到了 `gitWorkflowService.ts`。

这样 `diffStore.ts` 不再 import `gitStatusStore` 或 `uiStore`，只保留自己的局部状态。后续如果 Diff 视图继续增加 hunk 勾选、部分提交、AI 解释 diff 等功能，也更容易判断哪些是局部状态，哪些是业务 workflow。

---

## 八、处理 legacy 测试面板：App.tsx 不再背负测试界面

这次重构还顺手处理了一个历史遗留点：`App.tsx`。

项目早期需要测试 Electron Renderer 和 Go Sidecar 的通信，所以 `App.tsx` 里保留了一个命令输入面板。它能手动输入 Git 命令和 JSON payload，再展示返回历史。

这个测试面板很有价值，但它不应该继续挤在 `App.tsx` 里。

旧的 `App.tsx` 既判断运行模式，又包含完整测试面板 JSX，还直接订阅：

```tsx
const { loading, history, error, executeCommand, clearHistory } = useGitStore()
```

这和本次“组件不要直接认识 store”的目标冲突。

所以我把测试面板移动到：

```text
src/renderer/src/dev/SidecarTestPanel/index.tsx
```

并新增：

```text
useSidecarTestPanelModel.ts
gitCommandSelectors.ts
```

现在 `App.tsx` 变得非常轻：

```tsx
import MainApp from './MainApp'
import SidecarTestPanel from './dev/SidecarTestPanel'

function App(): React.JSX.Element {
  return window.electronAPI.mode === 'test' ? <SidecarTestPanel /> : <MainApp />
}

export default App
```

这个变化看起来只是移动代码，但它让正式应用入口、开发测试面板、原始 Git 命令 store 三者重新分开了。

---

## 九、增加边界检查：防止以后又退回去

重构代码只是第一步。如果没有约束，后续开发中很容易又写回：

```tsx
const foo = useSomeStore((state) => state.foo)
```

尤其是赶功能的时候，直接 import store 是最快的写法。所以这次我新增了一个边界检查脚本：

```text
scripts/check-renderer-boundaries.mjs
```

它检查三类问题：

```text
UI 文件直接 import store
store hook 完整订阅
组件中 inline selector
```

核心规则大致是：

```js
const uiRoots = ['components', 'layout', 'views', 'dev'].map((item) =>
  path.join(rendererRoot, item)
)

const directStoreImport = /from\s+['"][^'"]*store(?:\/[^'"]*)?['"]/g
const fullStoreSubscription = /\buse[A-Za-z]+Store\s*\(\s*\)/g
const inlineStoreSelector = /\buse[A-Za-z]+Store\s*\(\s*\(?\s*state\s*\)?\s*=>/g
```

并且 `package.json` 中把它接到了 lint 流程里：

```json
{
  "scripts": {
    "lint": "eslint --cache . && npm run check:renderer-boundaries",
    "check:renderer-boundaries": "node scripts/check-renderer-boundaries.mjs"
  }
}
```

这个脚本不是为了追求形式主义，而是为了保护这次重构产生的边界。以后新增页面时，如果有人直接在 `views/` 里 import store，检查会直接失败。

我觉得这类“防回退脚本”在项目重构里很重要。因为结构不是写完一篇文档就会自动保持的，它需要被工具持续守住。

---

## 十、这次重构后的目录变化

这次新增的核心目录和文件主要有几类。

第一类是 selector：

```text
src/renderer/src/store/selectors/
  repositorySelectors.ts
  gitStatusSelectors.ts
  diffSelectors.ts
  historySelectors.ts
  uiSelectors.ts
  operationSelectors.ts
  gitCommandSelectors.ts
  index.ts
```

第二类是 view model：

```text
src/renderer/src/viewModels/
  useActivityRailModel.ts
  useNotificationModel.ts
  useStatusBarModel.ts
  useDiffViewModel.ts
  useRepoPanelModel.ts
  useToolbarModel.ts
  useChangesViewModel.ts
  useHistoryViewModel.ts
  useSettingsViewModel.ts
  useSidecarTestPanelModel.ts
  README.md
```

第三类是视图内部组件：

```text
src/renderer/src/views/ChangesView/
  index.tsx
  FileSection.tsx
  DiffPane.tsx
  CommitPanel.tsx

src/renderer/src/views/HistoryView/
  index.tsx
  BranchPanel.tsx
  CommitGraph.tsx
  CommitDetail.tsx
```

第四类是 workflow 和工具：

```text
src/renderer/src/services/repositoryWorkflowService.ts
src/renderer/src/utils/branchOptions.ts
src/renderer/src/utils/commitGraph.ts
scripts/check-renderer-boundaries.mjs
```

从这些目录可以看出，这次重构不是为了“再拆几个文件”，而是为了让每一种代码都有更明确的位置。

---

## 十一、验证结果与当前状态

这次重构完成后，我执行了完整的前端和项目检查：

```text
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run check:renderer-boundaries
```

结果是：

```text
typecheck 通过
lint 通过
renderer boundary check 通过
```

需要说明的是，`lint` 过程中仍然会输出一些既有的 Prettier warning，集中在 `src/main/*` 和 `scripts/build-sidecar.mjs` 等旧文件里。这些 warning 不是本次重构新增代码导致，而且当前 lint 命令最终退出码为 0。

从边界检查结果看，现在已经满足：

```text
views / layout / components / dev 不直接 import store
不存在 useXxxStore() 形式的完整订阅
不存在组件内 inline selector
repositoryStore 不再承载 repository workflow
diffStore 不再承载 hunk workflow
legacy Sidecar 测试面板已经移出 App.tsx
```

---

## 十二、这次重构带来的理解

这次优化给我的最大感受是：状态管理真正难的地方，不只是“用不用 selector”，而是“谁有资格知道状态结构”。

如果每个组件都可以直接 import store，那么 store 的字段结构就会扩散到整个 UI 层。表面上看，每一处都只是写了一行 selector；但从架构上看，很多组件都被绑定到了 store 内部实现。

这会让后续演进变得困难。比如以后想把 `operationLoading` 从单值改成多个并发 operation，或者想把 `fileStatuses` 拆成 staged、unstaged、conflicted 几类缓存，如果组件直接读字段，就会牵一发动全身。

这次重构以后，变化路径会更稳定：

```text
store 内部变动
  -> 优先调整 selector
  -> 必要时调整 view model
  -> 组件尽量不动或少动
```

这也是我认为 view model 层最有价值的地方。它不是为了增加抽象而抽象，而是为 UI 和 store 之间加了一层缓冲区。

另外，我也更明确地感受到：store 不应该变成业务流程中心。仓库切换、提交、Push / Pull、Hunk 暂存这些流程，天然会牵扯多个状态域。如果都塞进 store，store 就会从状态容器退化成“前端总线”。所以把 workflow 放进 service 层，是为了让状态所有权和业务编排分开。

最后，这次加边界检查脚本也让我认识到，结构重构必须有工具兜底。单靠 README 约定，很难阻止后续代码在压力下回到旧写法。把约束接进 `npm run lint`，才算真正把架构规则变成项目规则。

---

## 十三、后续可以继续推进的方向

这次问题 3 的整改已经完成，但它也暴露出后续几个值得继续做的方向。

第一，CSS 分层仍然需要处理。现在 `main.css` 和 `features.css` 仍然比较大，旧测试界面样式和正式界面样式还没有完全分开。这对应结构体检里的问题 4。

第二，`services/` 里还可以继续细化 use case。现在 `gitWorkflowService.ts` 已经承担了提交、暂存、分支、远程等多个流程，后续如果功能继续增长，可以按 staging、commit、branch、remote 再拆一层。

第三，可以给关键纯函数补测试。比如 `splitFileStatuses()`、`buildBranchPickerOptions()`、`buildCommitLaneMap()` 都已经从组件里抽出来，后续很适合写成小单元测试。

第四，可以继续处理主进程和脚本里的既有 Prettier warning，让整个项目的 lint 输出更干净。

总体来看，这次重构是前端从“功能可用”继续走向“结构可维护”的一步。它没有新增用户可见功能，但它让后续新增 AI 分析、沙箱验证、冲突处理、更多 Git 工作流时，有了更清楚的状态订阅边界和组件扩展位置。
