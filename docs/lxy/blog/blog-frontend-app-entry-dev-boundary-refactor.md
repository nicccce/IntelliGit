> 本文为山东大学软件学院创新实训项目博客

# IntelliGit 前端入口与开发测试面板边界重构

这次做的是 IntelliGit 前端入口层的一次边界整理。

在前面几轮重构中，项目已经完成了很多结构性工作：原来很大的 `MainApp.tsx` 被拆成了 `app/`、`layout/`、`views/`、`components/`；原来的全局 `useAppStore.ts` 被拆成多个按状态所有权划分的 Zustand store；组件订阅方式也继续整理出了 selector 层、view model 层和 service workflow 层；后面 CSS 也从两个全局大文件迁移到了“全局基础样式 + CSS Modules”的结构。

这些工作完成以后，前端主干已经比最早清楚很多。但这次重新检查结构体检文档里的问题 5 时，我发现还有一个小入口没有真正收干净：`App.tsx`、正式主界面和 Sidecar 测试面板之间的关系。

最早的问题 5 是一个很直接的 React hooks 问题：旧的 `App.tsx` 先根据运行模式提前返回正式主界面，然后又在后面调用测试面板用的 hooks：

```tsx
if (mode !== 'test') {
  return <MainApp />
}

const [command, setCommand] = useState('')
const { loading, history, error, executeCommand, clearHistory } = useGitStore()
```

这会触发 React hooks 规则错误，因为 hooks 不能放在条件分支之后。表面看，这个问题只要把测试面板拆成单独组件就可以解决。

但我这次没有停在这个层面。

因为在当前代码里，条件 hooks 的 lint 错误其实已经没有了。`App.tsx` 已经可以根据 `mode` 渲染正式界面或测试面板，`npm.cmd run lint` 也不再报 hooks error。真正剩下的问题变得更细：测试面板虽然搬出去了，但它用的调试 store 还留在正式 `store/` 目录里；正式入口虽然已经移动到了 `app/MainApp.tsx`，但根目录还保留了一个 `MainApp.tsx` 转发文件。

这说明问题 5 已经从“修一个 lint 错误”变成了“彻底划清正式应用入口和开发测试入口的边界”。

这篇博客就记录一下这次我是怎么把这个边界继续收紧的。

---

## 一、问题已经不是条件 hooks，而是入口边界不够硬

这次开始之前，当前的 `App.tsx` 其实已经很短：

```tsx
import MainApp from './MainApp'
import SidecarTestPanel from './dev/SidecarTestPanel'

function App(): React.JSX.Element {
  return window.electronAPI.mode === 'test' ? <SidecarTestPanel /> : <MainApp />
}
```

从 React hooks 规则来看，这已经没有问题。`App.tsx` 自己没有调用任何 hooks，只是根据 `window.electronAPI.mode` 做入口选择。

但是继续往下看，会发现它仍然引用了：

```text
src/renderer/src/MainApp.tsx
```

而这个文件的内容只有一行：

```tsx
export { default } from './app/MainApp'
```

这个转发文件是在前面拆 `MainApp.tsx` 时留下的兼容入口。它当时是合理的，因为大文件拆分不应该一次性改太多引用，保留兼容导出可以降低迁移风险。

但到了问题 5 这一步，这个兼容层反而变成了一个新的模糊点。因为现在正式主界面的真实位置已经是：

```text
src/renderer/src/app/MainApp.tsx
```

如果根目录继续保留 `MainApp.tsx`，后续维护者仍然可能围绕旧路径理解项目，甚至继续往根目录入口上加东西。这样一来，前面做过的 app 层装配边界就会变软。

所以这次第一件事，是把入口路径彻底改清楚：

```tsx
import MainApp from './app/MainApp'
import SidecarTestPanel from './dev/SidecarTestPanel'
```

然后删除根目录的：

```text
src/renderer/src/MainApp.tsx
```

这个改动很小，但含义很明确：

```text
App.tsx 是唯一入口分流文件。
app/MainApp.tsx 是正式主界面的真实入口。
根目录 MainApp.tsx 不再作为兼容转发存在。
```

也就是说，入口结构从“有一个历史兼容壳”变成了“路径本身表达职责”。

---

## 二、把 mode 从普通字符串改成明确协议

入口分流依赖的是：

```tsx
window.electronAPI.mode
```

原来的类型定义比较宽：

```ts
mode?: string
```

这在早期开发阶段没什么问题，因为只要能从 preload 把环境变量传到 Renderer，功能就能跑起来。但如果从结构角度看，这个类型太松了。

`App.tsx` 实际只关心两种模式：

```text
main
test
```

但 `string` 表示任何字符串都可以传进来，比如：

```text
dev
debug
sidecar
undefined
空字符串
拼错的 tset
```

这类输入虽然大多数时候会自然落到正式主界面，但它没有把入口协议说清楚。项目越往后走，入口模式越应该是一个明确的契约，而不是一个随意字符串。

所以我在共享类型里新增了：

```ts
export type ElectronMode = 'main' | 'test'
```

并把 `ElectronAPI` 改成：

```ts
export interface ElectronAPI {
  mode: ElectronMode
}
```

同时在 preload 层做归一化：

```ts
function resolveElectronMode(mode: string | undefined): ElectronMode {
  return mode === 'test' ? 'test' : 'main'
}
```

最后暴露给 Renderer：

```ts
mode: resolveElectronMode(process.env.ELECTRON_MODE)
```

这样处理以后，Renderer 不需要再理解环境变量细节。对 Renderer 来说，`mode` 永远只有两种明确值：

```text
main
test
```

这里的重点不是“类型变得好看”，而是把 Electron preload 到 React Renderer 之间的小协议收紧了。入口层越小，越应该稳定，因为它是整个前端应用树的起点。

---

## 三、测试面板搬出去了，但测试状态还没搬干净

这次真正值得处理的，是 Sidecar 测试面板的状态归属。

当前正式业务状态已经拆成了多个 store：

```text
repositoryStore.ts
gitStatusStore.ts
diffStore.ts
historyStore.ts
uiStore.ts
operationStore.ts
```

这些 store 都是正式 Git 客户端界面的一部分。它们分别负责仓库列表、工作区状态、diff 状态、提交历史、UI 消息、操作 loading 等。

但是测试面板使用的 store 仍然放在：

```text
src/renderer/src/store/useGitStore.ts
```

它的职责和正式业务 store 完全不一样。它不是管理正式业务状态，而是记录开发测试面板里的原始命令执行历史：

```ts
export interface CommandRecord {
  id: number
  command: string
  payload?: Record<string, unknown>
  response: unknown
  timestamp: number
  success: boolean
}
```

更关键的是，它在 store 内直接调用了：

```ts
window.electronAPI.invokeGit(command, payload)
```

这对测试面板来说是合理的。因为测试面板的目的就是验证 Sidecar 原始通信链路，它需要允许输入任意 command 和 payload。

但这对正式 `store/` 目录来说就不合理了。

在前面的状态层重构中，我们已经确定了一条规则：

```text
正式业务 Git 调用必须通过 api/gitClient.ts。
store 只保存状态所有权和局部 mutation。
不要在 store 里直接调用 window.electronAPI.invokeGit。
```

`useGitStore.ts` 虽然只是调试用，但它放在正式 `store/` 里，就会让这个规则变得不纯粹。更麻烦的是，它还从正式 barrel export 暴露出去：

```ts
export { useGitStore } from './useGitStore'
export type { CommandRecord } from './useGitStore'
```

对应 selector 和 view model 也在正式目录中：

```text
src/renderer/src/store/selectors/gitCommandSelectors.ts
src/renderer/src/viewModels/useSidecarTestPanelModel.ts
```

这样一来，目录结构表达出来的是：

```text
Sidecar 测试面板状态是正式状态层的一部分。
Sidecar 测试面板 view model 是正式 viewModels 的一部分。
```

但这并不是我们想要的边界。

我的判断是：

```text
dev 工具可以有自己的状态。
dev 工具可以有自己的 raw client。
dev 工具不应该污染正式 store / viewModels / api 导出面。
```

所以这次真正的重构重点，是把 Sidecar 测试面板需要的东西都搬回它自己的目录。

---

## 四、让 SidecarTestPanel 自己拥有自己的小世界

这次我删除了正式层里的三个文件：

```text
src/renderer/src/store/useGitStore.ts
src/renderer/src/store/selectors/gitCommandSelectors.ts
src/renderer/src/viewModels/useSidecarTestPanelModel.ts
```

然后在测试面板目录下新增：

```text
src/renderer/src/dev/SidecarTestPanel/sidecarTestClient.ts
src/renderer/src/dev/SidecarTestPanel/sidecarCommandStore.ts
src/renderer/src/dev/SidecarTestPanel/sidecarCommandSelectors.ts
src/renderer/src/dev/SidecarTestPanel/useSidecarTestPanelModel.ts
```

新的结构是：

```text
SidecarTestPanel/
  index.tsx
  SidecarTestPanel.module.css
  sidecarTestClient.ts
  sidecarCommandStore.ts
  sidecarCommandSelectors.ts
  useSidecarTestPanelModel.ts
```

这样做以后，测试面板变成了一个完整的 dev-only 功能岛。

`sidecarTestClient.ts` 只做一件事：保留原始 Sidecar 调用能力。

```ts
import type { SidecarResponse } from '../../../../shared/types'

export function invokeRawSidecarCommand(
  command: string,
  payload?: Record<string, unknown>
): Promise<SidecarResponse> {
  return window.electronAPI.invokeGit(command, payload)
}
```

这里我没有强行复用正式的 `api/gitClient.ts`。

原因是正式 `api/gitClient.ts` 已经基于 Git command map 做了强类型封装，适合正式业务使用：

```ts
invokeGit<K extends GitCommandName>(
  command: K,
  ...args: GitCommandArgs<K>
): Promise<GitCommandResult<K>>
```

但测试面板的价值恰恰在于它可以输入任意 command 和 payload，用来验证 Sidecar 通信链路。它不应该被正式 command map 限制。

所以这里的边界不是“所有东西都必须走同一个 API”，而是：

```text
正式业务走 typed gitClient。
开发测试面板走 dev raw client。
raw client 不能从 dev 目录泄漏到正式业务。
```

`sidecarCommandStore.ts` 则只负责测试面板自己的状态：

```ts
export interface SidecarCommandStoreState {
  loading: boolean
  history: SidecarCommandRecord[]
  error: string | null
  executeCommand: (command: string, payload?: Record<string, unknown>) => Promise<void>
  clearHistory: () => void
}
```

这个 store 不再从正式 `store/index.ts` 导出，也不再放在正式 `store/` 目录里。它的所有权很清楚：只属于 `SidecarTestPanel`。

然后测试面板自己的 view model 也搬到同目录：

```ts
export function useSidecarTestPanelModel(): SidecarTestPanelModel {
  const loading = useSidecarCommandStore(selectSidecarCommandLoading)
  const history = useSidecarCommandStore(selectSidecarCommandHistory)
  const error = useSidecarCommandStore(selectSidecarCommandError)
  const executeCommand = useSidecarCommandStore(selectExecuteSidecarCommand)
  const clearHistory = useSidecarCommandStore(selectClearSidecarCommandHistory)

  return {
    loading,
    history,
    error,
    executeCommand,
    clearHistory
  }
}
```

最后 `SidecarTestPanel/index.tsx` 的 import 也从：

```tsx
import { useSidecarTestPanelModel } from '../../viewModels'
```

改成：

```tsx
import { useSidecarTestPanelModel } from './useSidecarTestPanelModel'
```

这个改动表达的意思很明确：测试面板不再消费正式 view model 层，它使用自己的本地 view model。

---

## 五、清理正式导出面

文件移动只是第一步，真正重要的是把导出面也清掉。

这次我修改了：

```text
src/renderer/src/store/index.ts
src/renderer/src/store/selectors/index.ts
src/renderer/src/viewModels/index.ts
```

删除这些导出：

```ts
export { useGitStore } from './useGitStore'
export type { CommandRecord } from './useGitStore'
export * from './gitCommandSelectors'
export * from './useSidecarTestPanelModel'
```

这样做以后，正式业务代码不能再通过统一入口拿到测试面板的 store、selector 或 view model。

这个细节很重要。

有时候文件已经移动了，但 barrel export 没有清理，结果其他模块还是可以很方便地 import 到旧概念。这样边界看起来变了，实际依赖面没有变。

所以这次我更关注“对外暴露了什么”。一个模块是否属于正式架构，不只看它放在哪里，也要看它是否从正式入口导出。

清理后的正式状态层只导出正式 store：

```text
repositoryStore
gitStatusStore
diffStore
historyStore
uiStore
operationStore
```

正式 selector 层也只导出正式业务 selector。

测试面板相关状态完全留在：

```text
src/renderer/src/dev/SidecarTestPanel/
```

---

## 六、用脚本把边界固定下来

只靠约定是不够的，因为项目继续迭代时，很容易因为一时方便把边界又打穿。

比如后面某个人可能会重新创建：

```text
src/renderer/src/MainApp.tsx
```

然后写：

```tsx
export { default } from './app/MainApp'
```

看起来没什么问题，但它会重新打开旧入口路径。

又比如正式业务里某个 service 想快速测试一个 Git 命令，直接写：

```ts
window.electronAPI.invokeGit('staging.status')
```

这也能跑，但它绕过了 `api/gitClient.ts` 和 Git command map，正式业务层又重新知道了 Sidecar 原始通信细节。

所以这次我补强了：

```text
scripts/check-renderer-boundaries.mjs
```

新增了三类检查。

第一，禁止恢复根目录 `MainApp.tsx`：

```text
src/renderer/src/MainApp.tsx
```

如果这个文件再次出现，边界检查会失败。

第二，禁止正式代码随意 import `dev/`：

```text
only App.tsx may import dev-only renderer modules
```

这里保留了一个例外：`App.tsx` 可以 import `dev/SidecarTestPanel`，因为它是唯一的运行模式分流入口。除此之外，正式 `app/`、`layout/`、`views/`、`components/`、`store/`、`services/`、`api/` 都不应该依赖 dev 模块。

第三，限制 raw `invokeGit` 的出现位置：

```text
raw invokeGit is only allowed in api/gitClient.ts
and dev/SidecarTestPanel/sidecarTestClient.ts
```

也就是说，正式业务只能通过：

```text
src/renderer/src/api/gitClient.ts
```

调试面板只能通过：

```text
src/renderer/src/dev/SidecarTestPanel/sidecarTestClient.ts
```

直接调用 `window.electronAPI.invokeGit`。其他位置出现 raw 调用，脚本会报错。

这个脚本的意义在于：把“这次重构的判断”变成“后续每次 lint 都会检查的规则”。

---

## 七、同步文档，避免后面的人按旧记忆写代码

结构改完以后，我同步更新了几份文档。

新增：

```text
src/renderer/src/dev/README.md
```

这个文档说明 `dev/` 是开发和调试入口目录。它可以拥有局部测试状态和 raw protocol client，但只能服务调试 UI，不得被正式业务层消费。

更新：

```text
src/renderer/src/app/README.md
src/renderer/src/store/README.md
docs/project-rules.md
```

其中 `app/README.md` 里明确写了：

```text
src/renderer/src/App.tsx 是唯一的渲染入口分流文件。
正式主界面的真实落点必须保持在 app/MainApp.tsx。
不要恢复根目录 MainApp.tsx 转发文件。
```

`store/README.md` 里明确写了：

```text
开发测试工具的状态不得放入正式 store/。
Sidecar 原始命令测试面板的 store、selector、raw client
都内聚在 dev/SidecarTestPanel/。
```

`project-rules.md` 里则把项目级规则同步调整为：

```text
正式 UI 通过正式 viewModels 消费正式 store。
dev 调试入口不得 import 正式 store。
dev 可以在自己的面板目录内维护局部测试 store、selector 和 view model。
```

这一步看起来像文档工作，但对长期维护很重要。因为结构边界不是一次改完就永远安全，后续每个人都要能从文档里看到当前真实结构，而不是继续按照旧的 walkthrough 记忆写代码。

---

## 八、验证结果

这次改完以后，我跑了三类检查：

```bash
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

结果是：

```text
lint 通过
typecheck 通过
build 通过
```

其中 `lint` 会继续执行：

```text
check:renderer-boundaries
check:renderer-styles
```

这两个边界检查也都通过了。

当前 `lint` 还有 63 个 Prettier warning，位置主要在：

```text
scripts/build-sidecar.mjs
src/main/core/SidecarManager.ts
src/main/index.ts
src/main/ipc/configHandlers.ts
src/main/ipc/gitHandlers.ts
```

这些 warning 是已有 main / build 脚本格式问题，不是这次入口边界重构引入的新错误。因为这次任务集中在问题 5，我没有顺手格式化这些无关文件，避免把一次结构提交扩大成格式化提交。

---

## 九、这次重构后的结构

现在前端入口结构变成：

```text
src/renderer/src/App.tsx
  -> app/MainApp
  -> dev/SidecarTestPanel

src/renderer/src/app/
  -> MainApp.tsx
  -> AppProviders.tsx
  -> appTheme.ts
  -> useThemeMode.ts
  -> useAutoRefresh.ts

src/renderer/src/dev/
  -> README.md
  -> SidecarTestPanel/
       index.tsx
       SidecarTestPanel.module.css
       sidecarTestClient.ts
       sidecarCommandStore.ts
       sidecarCommandSelectors.ts
       useSidecarTestPanelModel.ts
```

正式 store 目录里不再有：

```text
useGitStore.ts
gitCommandSelectors.ts
```

正式 viewModels 目录里不再有：

```text
useSidecarTestPanelModel.ts
```

根目录也不再有：

```text
src/renderer/src/MainApp.tsx
```

这样一来，结构表达出的含义就很清楚：

```text
正式入口属于 app。
开发测试入口属于 dev。
正式状态属于 store。
调试状态属于调试面板自己。
正式 Git 调用走 typed client。
原始 Sidecar 调用只存在于 dev raw client。
```

---

## 十、这次重构的收获

这次问题 5 看起来比前几轮重构小很多。它不像拆 `MainApp.tsx` 那样移动大量组件，也不像拆 `useAppStore.ts` 那样重排很多业务流程。

但它处理的是一个很容易被忽略的问题：临时开发工具和正式业务代码之间的边界。

在一个项目早期，测试面板、调试 store、raw IPC 调用往往都是必要的。没有这些东西，很多底层通信和 Sidecar 行为很难快速验证。问题不在于它们存在，而在于它们不能一直待在正式架构的核心层里。

这次重构以后，Sidecar 测试面板仍然保留，而且能力没有被削弱。它仍然可以输入任意 command 和 payload，仍然可以直接验证原始通信链路。但它的位置变了：它不再伪装成正式 store 的一部分，也不再从正式 viewModels 导出。

我觉得这是项目结构逐渐成熟时很重要的一步：

```text
不是删除开发工具，
而是给开发工具一个清楚的位置。
```

正式代码和调试工具都可以存在，但它们应该通过目录、导出、类型和检查脚本表达出不同身份。这样后续继续扩展功能时，项目才不会因为早期留下的小方便，慢慢重新长成一个边界模糊的大文件集合。
