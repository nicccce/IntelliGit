# IntelliGit 项目结构体检与后续整改清单

这次主要对 IntelliGit 当前项目结构做了一轮整体检查，重点不是修复某个具体功能，而是把项目里已经暴露出来的结构问题、耦合问题、单文件过长问题先列清楚，方便后续逐项修整。

整体结论是：项目当前还能正常通过 TypeScript 类型检查和 Go 测试，但前端和 Sidecar 后端都已经进入“功能跑通以后，需要整理结构”的阶段。下面按照问题类型列出本次发现。

---

## 1. 前端主界面单文件过长、职责过多

涉及文件：

```text
src/renderer/src/MainApp.tsx
```

现状：

`MainApp.tsx` 有 1261 行，里面同时放了主题配置、仓库侧栏、顶部工具栏、变更视图、Diff、历史图、设置页、通知栏、状态栏和大量交互逻辑。

同时，项目里虽然已经有：

```text
src/renderer/src/components/
src/renderer/src/views/
```

但这两个目录目前只有 README，实际组件还没有按照既定结构拆出来。

问题影响：

后续任何人修改仓库侧栏、历史视图、设置页、Diff 展示或状态栏，都需要进入同一个超大文件。修改边界不清楚，容易造成局部改动影响其他视图。

后续整改方向：

```text
MainApp.tsx
  -> 只保留应用装配、主题 Provider、顶层布局

views/ChangesView/
views/HistoryView/
views/SettingsView/

components/ActivityRail/
components/RepoSidebar/
components/Toolbar/
components/DiffView/
components/NotificationBar/
components/StatusBar/
```

优先级：高。

---

## 2. 全局 Zustand store 过度膨胀

涉及文件：

```text
src/renderer/src/store/useAppStore.ts
```

现状：

`useAppStore.ts` 有 946 行，同时管理配置、仓库列表、Git 状态、远程认证、Diff/Hunk、Commit Graph、UI 消息和视图状态。

它已经不是单纯 store，而是混合了：

```text
service
adapter
state machine
UI state
IPC 调用封装
```

问题影响：

状态边界不清楚。仓库配置、Git 工作区状态、Diff 临时状态、UI 消息和远程认证信息都在一个 store 里，后续功能越多，越难判断某个 action 到底会影响哪些状态。

后续整改方向：

```text
api/gitClient.ts
  -> 封装 window.electronAPI.invokeGit

store/repositoryStore.ts
  -> 仓库列表、当前仓库、仓库切换

store/gitStatusStore.ts
  -> 文件状态、分支、ahead/behind

store/diffStore.ts
  -> 当前文件 diff、hunk 操作

store/historyStore.ts
  -> commit history、commit graph、selected commit

store/uiStore.ts
  -> activeView、loading、error、successMessage
```

优先级：高。

---

## 3. 组件订阅 store 的方式会放大耦合和重渲染

涉及文件：

```text
src/renderer/src/MainApp.tsx
```

代表位置：

```text
MainApp.tsx line 146 附近
```

现状：

`MainApp.tsx` 多处直接调用：

```tsx
useAppStore()
```

没有使用 selector 精确订阅所需字段。

问题影响：

任何状态变化都容易让相关组件整体重新渲染。当前项目规模还不算特别大，但后续 Diff、历史图、AI 分析、沙箱测试等功能继续增加后，性能问题和状态定位问题都会变难。

后续整改方向：

组件中尽量改成 selector：

```tsx
const currentRepo = useAppStore((state) => state.currentRepo)
const switchRepo = useAppStore((state) => state.switchRepo)
```

或者在拆分 store 后，让每个组件只订阅自己所属模块的状态。

优先级：中高。

---

## 4. CSS 已经分层混乱

涉及文件：

```text
src/renderer/src/assets/main.css
src/renderer/src/assets/features.css
src/renderer/src/main.tsx
```

现状：

`main.css` 有 1669 行，既包含旧测试面板 `.app-*`，又包含正式界面 `.ig-*`。

`features.css` 有 1308 行，又继续覆盖大量 `.ig-*`。

两个 CSS 在 `main.tsx` 里同时全局引入：

```tsx
import './assets/main.css'
import './assets/features.css'
```

问题影响：

样式依赖加载顺序，后续很容易出现隐式覆盖。旧测试面板样式和正式界面样式混在一起，也不方便删除或重构。

后续整改方向：

```text
assets/base.css
assets/theme.css

components/Toolbar/styles.css
components/RepoSidebar/styles.css
views/ChangesView/styles.css
views/HistoryView/styles.css
views/SettingsView/styles.css
```

先把旧测试面板 `.app-*` 和正式界面 `.ig-*` 拆开，再逐步让样式跟随组件或视图。

优先级：中高。

---

## 5. App.tsx 同时承担正式入口和测试面板，且已有 lint 错误

涉及文件：

```text
src/renderer/src/App.tsx
```

现状：

`App.tsx` 先根据 `mode` 提前 return：

```tsx
if (mode !== 'test') {
  return <MainApp />
}
```

然后在后面调用 hooks：

```tsx
const [command, setCommand] = useState('')
const { loading, history, error, executeCommand, clearHistory } = useGitStore()
```

这触发了 React hooks 规则错误。

验证结果：

```text
npm.cmd run lint
```

报 6 个错误，全部来自这个文件的条件 hooks。

后续整改方向：

```text
App.tsx
  -> 只判断 mode，选择渲染 MainApp 或 TestPanel

TestPanel.tsx
  -> 承载 Sidecar 通信测试面板和相关 hooks

MainApp.tsx
  -> 正式主界面
```

优先级：高。

---

## 6. 前后端 IPC/Git 协议类型太弱

涉及文件：

```text
src/shared/types/sidecar.ts
src/renderer/src/store/useAppStore.ts
src/preload/index.ts
src/main/ipc/gitHandlers.ts
```

现状：

`sidecar.ts` 中的接口过于宽泛：

```ts
invokeGit: (command: string, payload?: Record<string, unknown>) => Promise<SidecarResponse>
```

前端大量使用：

```ts
response.data as ...
```

命令名、payload、返回类型没有强约束。

问题影响：

后端改命令名、改 payload 字段或改返回结构时，前端很难在编译期发现问题，只能等运行时暴露。

后续整改方向：

建立 Git command map：

```ts
type GitCommandMap = {
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

再封装强类型调用：

```ts
invokeGit<K extends keyof GitCommandMap>(
  command: K,
  payload: GitCommandMap[K]['payload']
): Promise<GitCommandMap[K]['result']>
```

优先级：中高。

---

## 7. Sidecar 只有一个全局当前仓库，和前端多仓库 UI 不匹配

涉及文件：

```text
sidecar/internal/handler/router.go
```

代表位置：

```text
router.go line 128 附近
```

现状：

`Router` 保存单个当前仓库：

```go
repo *git.Repository
```

前端支持仓库列表，但 Git 操作默认作用于 Sidecar 当前保存的 repo。

问题影响：

如果之后出现多窗口、并发刷新、切仓库时未完成请求，容易出现串仓库的问题。比如 A 仓库的刷新请求还没结束，用户切到 B 仓库后，Sidecar 的当前 repo 已经变了。

后续整改方向：

可以考虑让 Git 命令显式携带 repo path：

```json
{
  "command": "staging.status",
  "payload": {
    "repoPath": "E:/xxx/project"
  }
}
```

或者在 Sidecar 内部维护 repo session，而不是全局单例 repo。

优先级：中高。

---

## 8. Go handler 层是后端版“大文件”

涉及文件：

```text
sidecar/internal/handler/handlers.go
sidecar/internal/handler/registry.go
```

现状：

`handlers.go` 有 817 行，repo、staging、commit、branch、remote、merge、diff 全部在一个文件中。

虽然 `registry.go` 已经集中注册命令，但具体实现没有按业务域拆分。

问题影响：

后续新增命令时，这个文件会继续变长。不同业务域的 handler 互相挤在一起，不利于多人协作和局部维护。

后续整改方向：

```text
repo_handlers.go
staging_handlers.go
commit_handlers.go
branch_handlers.go
remote_handlers.go
merge_handlers.go
diff_handlers.go
```

`registry.go` 继续集中注册，具体 handler 实现按业务域拆分。

优先级：中。

---

## 9. Git 实现策略混杂

涉及文件：

```text
sidecar/internal/git/remote.go
sidecar/internal/git/staging_hunk.go
sidecar/internal/git/operations.go
```

现状：

项目混用了 go-git 和系统 git CLI。

这件事本身可以接受，因为 go-git 在 hunk 暂存、merge、raw diff 等细粒度场景下确实有能力边界。

问题在于现在缺少统一 adapter 边界，错误处理、环境变量、行为差异分散在多个文件里。

问题影响：

后续排查 Git 行为时，很难第一眼判断某个功能到底走 go-git 还是走系统 git。认证失败、非交互式环境、merge 冲突、CLI 输出解析等问题也容易重复处理。

后续整改方向：

```text
GoGitBackend
  -> 对象模型、状态、提交、分支等能力

GitCliBackend
  -> hunk、raw diff、merge、特殊 log 等能力

Repository
  -> 对 handler 暴露稳定 API
```

同时把 CLI 环境变量和错误包装集中管理。

优先级：中。

---

## 10. 自动刷新过重

涉及文件：

```text
src/renderer/src/MainApp.tsx
src/renderer/src/store/useAppStore.ts
```

代表位置：

```text
MainApp.tsx line 1173 附近
```

现状：

主界面每 1 秒调用一次：

```ts
refreshAllLocal()
```

而 `refreshAllLocal()` 会刷新：

```text
status
history
branch
ahead/behind
```

问题影响：

大仓库下成本会很重，也会和用户操作产生状态竞争。比如用户正在 Push、Pull、Reset 或切分支时，后台刷新也在同时更新 store。

后续整改方向：

```text
文件状态
  -> 更轻量的 watch / debounce / 手动刷新

提交历史
  -> commit、pull、push、checkout 后刷新

分支列表
  -> branch 操作或 remote fetch 后刷新

ahead/behind
  -> 按需刷新，不每秒计算
```

优先级：中高。

---

## 11. 凭据被放进普通配置文件

涉及文件：

```text
src/shared/types/sidecar.ts
src/main/ipc/configHandlers.ts
src/renderer/src/store/useAppStore.ts
```

代表位置：

```text
sidecar.ts line 73 附近
configHandlers.ts line 36 附近
```

现状：

`RepoConfig` 定义了：

```ts
authPassword?: string
sshPassword?: string
```

然后 `configHandlers.ts` 直接把 config 写入 userData：

```ts
JSON.stringify(config)
```

问题影响：

HTTP token 或 SSH passphrase 可能以明文形式进入普通配置文件。这个不仅是安全问题，也让配置、认证、Git 操作强耦合。

后续整改方向：

```text
RepoConfig
  -> 只保存路径、名称、远程地址、远程类型等非敏感信息

CredentialStore
  -> 保存 token、password、ssh passphrase

remotePayload()
  -> 操作时临时组装认证信息
```

后续正式产品化时，最好接入系统 keychain / credential manager。

优先级：高。

---

## 12. 仓库内容混入了产物和过程资料

涉及位置：

```text
sidecar/sidecar.exe
.gitignore
docs/
```

现状：

`sidecar/sidecar.exe` 是 git 跟踪文件，但 `.gitignore` 只忽略了：

```text
sidecar/intelligit-sidecar.exe
sidecar/cmd/sidecar/sidecar.exe
resources/intelligit-sidecar.exe
```

此外，`docs/` 下混有成员个人目录、HTML 原型、demo code、test 文件和历史 blog。

问题影响：

仓库结构更像工作记录集合，不像产品工程文档。后续新人进入项目时，不容易判断哪些是正式文档、哪些是原型、哪些是过程记录、哪些是可以删除的产物。

后续整改方向：

```text
docs/requirements/
docs/design/
docs/prototypes/
docs/blog/
docs/archive/
```

同时确认哪些二进制产物需要提交，哪些应该彻底忽略。

优先级：中。

