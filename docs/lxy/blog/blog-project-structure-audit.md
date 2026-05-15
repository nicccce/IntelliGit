> 本文为山东大学软件学院创新实训项目博客

#  IntelliGit 项目结构检查：当功能跑通以后，结构债不可忽略

这次做的不是一个具体 Bug 修复，也不是新增某个功能，而是对 IntelliGit 当前项目结构做了一次比较完整的体检。

在前面的开发中，IntelliGit 已经陆续打通了很多关键链路：Electron 主进程、React 前端、Go Sidecar、Git 状态读取、提交、Push / Pull、分支切换、Diff 展示、仓库配置等等。功能越堆越多以后，一个很自然的问题也开始出现：项目能跑，但代码是不是还好维护？

这次我看的重点不是“哪里语法错了”，而是下面几类问题：

```text
项目结构是否清晰
单文件是否过长
组件和状态是否耦合过高
前后端协议边界是否明确
后续继续加功能时，修改成本会不会越来越高
```

最后的结论比较明确：项目目前还能正常通过类型检查和 Go 测试，但已经出现了典型的“功能先跑通，结构后补课”的阶段性问题。尤其是前端的 `MainApp.tsx`、`useAppStore.ts` 和全局 CSS，已经开始承担太多职责；后端 Go Sidecar 的 handler 层也有类似趋势。

这篇博客就记录一下这次结构体检的过程，以及我对 IntelliGit 后续重构方向的一些判断。

---

## 一、先确认项目现在是什么形态

项目整体是一个典型的桌面端混合架构：

```text
Electron Main Process
  -> 负责窗口、IPC、Sidecar 进程管理

Preload
  -> 通过 contextBridge 暴露安全 API 给 Renderer

React Renderer
  -> IntelliGit 的主要界面

Go Sidecar
  -> 负责真正的 Git 操作
```

从目录上看，核心代码主要分布在两个地方：

```text
src/
  main/       Electron 主进程
  preload/    预加载脚本
  renderer/   React 前端
  shared/     前后端共享类型

sidecar/
  cmd/        Go 程序入口
  internal/   Git、handler、protocol 等内部模块
```

这个大方向是合理的。Electron 负责桌面壳，React 负责界面，Go 负责 Git 能力，三者职责在架构层面是分开的。

真正的问题不在“项目选型不对”，而是在每一层内部，很多东西还没有继续细分。也就是说，第一层边界是清楚的，但第二层、第三层边界开始变得模糊。

---

## 二、最直观的问题：几个文件已经明显过长

我先做了一次文件行数统计。结果非常醒目：

```text
src/renderer/src/assets/main.css              1669 行
src/renderer/src/assets/features.css          1308 行
src/renderer/src/MainApp.tsx                  1261 行
src/renderer/src/store/useAppStore.ts          946 行
sidecar/internal/handler/handlers.go           817 行
sidecar/internal/git/diff.go                   549 行
```

单文件长不一定就是坏事。有些文件虽然长，但如果职责高度内聚，比如纯数据表、协议定义、测试用例集合，也可以接受。

但这几个文件的问题在于：它们不是“一个职责写得比较完整”，而是“多个职责暂时住在同一个文件里”。

比如 `MainApp.tsx` 里面同时包含：

```text
主题 token 配置
仓库侧栏
顶部工具栏
变更视图
Diff 视图
历史视图
设置页
通知栏
状态栏
自动刷新逻辑
大量弹窗和表单交互
```

这就说明它已经不只是一个入口组件，而是整个前端工作台的集合体。后续任何人要改历史视图、设置页、仓库弹窗、主题、状态栏，都要进入同一个大文件里。

这类文件最麻烦的地方不是“行数多看着累”，而是它会让修改边界变得不清楚。一个看似局部的小改动，很容易影响同文件里的其他逻辑。

---

## 三、前端组件目录已经规划了，但实现还没有跟上

项目里其实已经有 `components` 和 `views` 两个目录：

```text
src/renderer/src/components/
src/renderer/src/views/
```

这两个目录里都有 README，说明当时已经意识到前端应该按组件和视图拆分。

`components/README.md` 里规划的是基础 UI 组件，例如：

```text
Button
Input
StatusBadge
DiffViewer
Terminal
```

`views/README.md` 里规划的是业务视图，例如：

```text
Workspace
History
Settings
BranchGraph
```

但实际情况是，这些目录目前只有 README，没有真正承载业务代码。正式界面的大部分内容仍然集中在 `MainApp.tsx` 里。

这就形成了一个很有意思的状态：项目“知道自己应该怎么长”，但代码还没有真正长到那个结构里。

我觉得这也是很多项目从原型走向产品时会遇到的节点。早期为了快，先把功能写在一个文件里很正常；但当功能已经验证过以后，就应该把已经稳定下来的区域拆出去，让目录结构重新反映业务结构。

---

## 四、`useAppStore.ts` 已经变成了第二个主程序

前端另一个核心问题是 Zustand store 太大。

`useAppStore.ts` 现在有 946 行，里面不仅保存状态，还包含大量业务操作：

```text
配置读取和保存
仓库添加、创建、克隆、切换
远程仓库探测
文件状态刷新
提交历史刷新
分支列表刷新
Push / Pull
Commit
Diff 读取
Hunk 暂存
Commit Graph
Checkout Commit
Reset Commit
错误和成功消息
```

这已经不是普通意义上的 store，而是一个混合体：

```text
Store
  + Git service
  + Config service
  + IPC adapter
  + UI message manager
  + Repository state machine
```

短期看，这种写法很方便。组件只要 `useAppStore()`，就能拿到所有状态和动作。

但长期看，它会带来两个问题。

第一个问题是状态边界不清楚。配置状态、仓库状态、Git 工作区状态、Diff 临时状态、UI 消息状态都在一起，任何逻辑都可以直接读写任意部分。

第二个问题是组件订阅会变粗。`MainApp.tsx` 里很多组件直接调用：

```tsx
const { repos, currentRepo, switchRepo, addRepo, createRepo, cloneRepo } = useAppStore()
```

或者直接：

```tsx
const { workdirDiff, selectedFilePath } = useAppStore()
```

如果没有 selector，状态变化很容易带来过大的重渲染范围。当前项目规模还不算特别大，所以问题不一定明显；但如果 Diff、历史图、AI 分析、沙箱测试这些功能继续加进去，store 会越来越像一个没有边界的全局变量。

比较理想的方向是把它拆成几层：

```text
api/gitClient.ts
  -> 只负责调用 window.electronAPI.invokeGit

services/repositoryService.ts
  -> 负责仓库配置、远程探测、认证 payload 组装

store/repositoryStore.ts
  -> 当前仓库、仓库列表

store/gitStatusStore.ts
  -> 文件状态、分支、ahead/behind

store/diffStore.ts
  -> 当前文件 diff、hunk 操作

store/uiStore.ts
  -> 视图、通知、loading
```

这样前端状态会更像几个小工作台，而不是所有工具都堆在同一个抽屉里。

---

## 五、CSS 的问题不是多，而是两套时代叠在一起

前端样式文件也比较典型。

现在入口里同时引入了：

```tsx
import './assets/main.css'
import './assets/features.css'
```

其中 `main.css` 有 1669 行，`features.css` 有 1308 行。

我看下来发现，`main.css` 里既有早期测试面板的 `.app-*` 样式，也有正式工作台的 `.ig-*` 样式；`features.css` 里又继续定义和覆盖大量 `.ig-*`。

这说明样式系统现在不是按组件或视图组织的，而是按开发阶段自然堆叠出来的。

早期测试面板还在：

```text
.app-container
.app-header
.dashboard-grid
.status-card
.history-list
```

正式界面也在：

```text
.ig-app
.ig-toolbar
.ig-changes-view
.ig-history-view
.ig-settings-view
.ig-statusbar
```

问题不是“CSS 行数多”，而是两个阶段的样式共享同一个全局命名空间。全局 CSS 最大的风险就是隐式覆盖：你改一个类名附近的规则，以为只影响一个区域，实际上可能会影响另一个视图。

如果后续拆组件，我认为 CSS 也应该跟着拆：

```text
MainApp.tsx
MainApp.css

views/ChangesView/index.tsx
views/ChangesView/styles.css

views/HistoryView/index.tsx
views/HistoryView/styles.css

components/DiffViewer/index.tsx
components/DiffViewer/styles.css
```

不一定马上引入 CSS Modules，但至少应该让样式文件和组件边界一致。这样以后删掉测试面板时，也能很清楚地知道哪些样式可以一起删除。

---

## 六、`App.tsx` 暴露了一个真实的 lint 问题

这次我还跑了一下检查：

```bash
npm.cmd run typecheck
go test ./...
npm.cmd run lint
```

结果是：

```text
TypeScript typecheck 通过
Go test ./... 通过
ESLint 未通过
```

ESLint 的 6 个错误全部来自 `App.tsx` 的 hooks 调用顺序。

现在 `App.tsx` 的逻辑大致是：

```tsx
function App() {
  const mode = window.electronAPI.mode

  if (mode !== 'test') {
    return <MainApp />
  }

  const [command, setCommand] = useState('')
  const [payloadStr, setPayloadStr] = useState('{}')
  const { loading, history, error, executeCommand, clearHistory } = useGitStore()

  ...
}
```

也就是说，如果不是 test 模式，函数会提前 return；如果是 test 模式，才继续调用 hooks。

React 的规则要求 hooks 在每次 render 中调用顺序必须一致。虽然 `mode` 在运行过程中大概率不会变，但从代码规则上看，这仍然是条件 hooks。

这个问题也从侧面说明：正式入口和测试面板最好拆开。

更清晰的写法应该是：

```text
App.tsx
  -> 只判断 mode
  -> 渲染 MainApp 或 TestPanel

TestPanel.tsx
  -> 自己内部使用 useGitStore / useKeyboardShortcut
```

这样正式界面和测试界面互不干扰，lint 也能回到干净状态。

---

## 七、Sidecar 的 handler 层也开始变成“大文件入口”

前端不是唯一的问题。Go Sidecar 里也有一个明显的大文件：

```text
sidecar/internal/handler/handlers.go  817 行
```

这个文件里现在放了很多类别的 handler：

```text
repo.open
repo.init
repo.clone

staging.status
staging.add
staging.remove
staging.applyPatch

commit.create
commit.log
commit.reset
commit.checkoutCommit

branch.list
branch.checkout
branch.aheadBehind

remote.fetch
remote.pull
remote.push

merge.status
merge.abort
merge.continue

diff.workdir
diff.commits
diff.withParent
```

这和前端 `MainApp.tsx` 的问题很像：所有东西都能在一个文件里找到，短期很方便；但随着命令越来越多，文件会变得越来越像“命令仓库”。

比较好的拆法是按命令域分文件：

```text
repo_handlers.go
staging_handlers.go
commit_handlers.go
branch_handlers.go
remote_handlers.go
merge_handlers.go
diff_handlers.go
```

`registry.go` 继续负责集中注册命令，这个设计可以保留。只是具体实现不应该全部挤在一个文件里。

这样做还有一个好处：当后续某个人只负责 merge 冲突 UI 对接时，他只需要重点看 `merge_handlers.go` 和 `remote.go`，而不必在 800 多行 handler 文件里上下滚动。

---

## 八、Go Git 层的问题：go-git 和系统 git CLI 混用，需要一个明确边界

Sidecar 的 Git 层现在主要基于 go-git，但并不是完全只用 go-git。

比如普通的 status、commit、branch 操作大量使用 go-git；但 hunk 暂存、原始 diff、merge 继续/中止、部分 log 能力又会调用系统 `git` CLI：

```go
exec.Command("git", "apply", "--cached", "--unidiff-zero", "-")
exec.Command("git", "-C", r.path, "merge", "--no-edit", ref)
exec.Command("git", "-C", r.path, "diff", "--name-only", "--diff-filter=U")
```

这本身并不是错误。前面做 hunk 暂存和 merge 工作流时已经证明，go-git 在某些细粒度场景下能力有限，借助系统 Git 是现实选择。

但现在的问题是：混用策略还没有被抽象成清晰边界。

理想情况下，Git 层应该明确区分：

```text
GoGitBackend
  -> 使用 go-git 完成对象模型、分支、提交、状态等能力

GitCliBackend
  -> 使用系统 git 完成 hunk、merge、raw diff 等能力

Repository
  -> 对上层暴露稳定方法，不让 handler 关心底层到底是 go-git 还是 CLI
```

这样后续如果某个命令从 go-git 改成 CLI，或者从 CLI 改回 go-git，上层 handler 和前端都不需要跟着动。

现在虽然大部分 CLI 调用仍然封装在 `internal/git` 包里，但环境变量、错误包装、行为差异还比较分散。尤其是认证失败、merge 冲突、非交互式环境这些细节，最好集中成一个 Git CLI adapter。

---

## 九、前后端协议现在太“自由”

前端调用 Sidecar 的入口是：

```ts
invokeGit: (command: string, payload?: Record<string, unknown>) => Promise<SidecarResponse>
```

这个接口非常灵活，任何命令字符串都可以传，任何 payload 都可以传，返回值也是 `unknown`。

灵活的代价就是类型约束不够。比如前端 store 里会出现很多这样的代码：

```ts
set({ branches: (branchRes.data as BranchInfo[]) || [] })

const data = currentRes.data as { branch: string }

set({ workdirDiff: response.data as PatchDetail })
```

这些 `as` 其实是在告诉 TypeScript：“我知道它是什么，你先相信我。”

但如果 Go 端某个命令返回结构变了，或者命令名打错了，TypeScript 很难提前发现。

我觉得后续可以考虑建立一个命令表：

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

然后把 `invokeGit` 包一层：

```ts
invokeGit<K extends keyof GitCommandMap>(
  command: K,
  payload: GitCommandMap[K]['payload']
): Promise<GitCommandMap[K]['result']>
```

这样前端和后端之间至少在 TypeScript 侧有一张清晰的协议地图。它不能完全替代 Go 端类型校验，但能显著减少前端随手 `as` 的数量。

---

## 十、自动刷新策略也需要重新思考

当前正式界面里有自动刷新：

```ts
const AUTO_REFRESH_INTERVAL = 1000

timerRef.current = setInterval(() => {
  refreshAllLocal()
}, AUTO_REFRESH_INTERVAL)
```

`refreshAllLocal()` 并不只是刷新文件状态，它还会刷新：

```text
staging.status
commit.log
branch.list
branch.current
branch.aheadBehind
```

也就是说，只要打开仓库，前端每秒都会向 Sidecar 请求一组 Git 状态。

这对小仓库可能没什么感觉，但对大仓库来说成本会比较高。更麻烦的是，这种轮询可能和用户操作交织在一起。

比如用户正在切分支、Push、Pull、Reset，后台刷新也同时在跑，就可能出现短暂的状态覆盖。当前代码里已经有一些“先本地刷新，再异步刷新远程”的处理，这说明项目其实已经遇到过这类状态时序问题。

后续更稳的方向可能是：

```text
文件状态：使用更轻量的 watch / debounce
历史记录：只在 commit、checkout、pull、push 后刷新
分支列表：只在 branch 操作或远程刷新后更新
ahead/behind：按需刷新，不必每秒计算
```

简单说，就是不要把“所有状态”都绑到一个固定轮询里。

---

## 十一、凭据存储也暴露出配置层边界问题

这次我还注意到一个比较重要的安全和架构问题。

`RepoConfig` 里包含：

```ts
authPassword?: string
sshPassword?: string
```

这些字段会跟普通配置一起保存：

```ts
writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf-8')
```

也就是说，HTTP token 或 SSH key passphrase 可能会以明文形式写进 app 的配置文件。

这个问题不只是安全问题，也说明配置层和认证层现在耦合在一起了。

更合理的结构应该是：

```text
RepoConfig
  -> 保存仓库路径、名称、远程地址、远程类型等非敏感信息

CredentialStore
  -> 通过系统 keychain / credential manager 保存 token 和密码

remotePayload()
  -> 操作时临时组装认证信息，不把敏感字段当普通配置到处传
```

这部分如果后续要做正式产品化，优先级应该比较高。

---

## 十二、仓库里混入了一些阶段性产物

结构体检时，我还看了一下仓库里的非源码内容。

`.gitignore` 已经忽略了 `dist`、`out`、`build`、`.tmp` 等目录，但当前仓库里仍然有一个被 Git 跟踪的二进制：

```text
sidecar/sidecar.exe
```

而真正打包使用的 sidecar 二进制在：

```text
resources/intelligit-sidecar.exe
```

这会让人比较困惑：到底哪个 exe 是开发产物，哪个 exe 是打包资源，哪个应该提交？

另外，`docs/` 目录也比较像工作区集合：

```text
docs/czl/
docs/lxy/
docs/zm/
docs/koishi/
```

里面有需求文档、博客、HTML 原型、demo code、测试文件和个人过程记录。这些内容本身都有价值，但如果不分层，后面查资料时会越来越难。

我觉得可以逐步整理成：

```text
docs/requirements/
docs/design/
docs/blog/
docs/prototypes/
docs/archive/
```

这样文档就不只是“放得下”，而是“找得到”。

---

## 十三、这次检查的结果

我最后跑了三类检查。

TypeScript 类型检查：

```bash
npm.cmd run typecheck
```

结果通过。

Go 测试：

```bash
go test ./...
```

第一次因为 Go 默认 cache 指向用户目录，遇到了权限问题；改成工作区内的 `GOCACHE` 后，测试通过。

ESLint：

```bash
npm.cmd run lint
```

结果没有通过，主要问题是 `App.tsx` 中测试面板 hooks 条件调用，另外还有一批 Prettier 警告。

所以这次体检可以总结成：

```text
项目不是坏掉了
项目也不是不能继续开发

但它已经到了应该重构结构的阶段
```

这类问题不会像运行时报错那样立刻跳出来，但它会慢慢影响每一次修改的成本。

---

## 十四、我认为后续最适合的重构顺序

如果后续要整理，我不建议一上来做“大重构”。这个项目现在功能链路已经跑通，最重要的是保持可运行，然后一点一点把结构梳顺。

我会优先按这个顺序来：

```text
第一步：拆 App.tsx
  -> MainApp 和 TestPanel 分离
  -> 修掉 hooks lint 错误

第二步：拆 MainApp.tsx
  -> ActivityRail
  -> RepoSidebar
  -> Toolbar
  -> ChangesView
  -> HistoryView
  -> SettingsView
  -> StatusBar

第三步：拆 useAppStore.ts
  -> 先抽 gitClient
  -> 再按 repository / status / diff / history / ui 分 slice

第四步：拆 CSS
  -> 旧测试面板样式和正式工作台样式分离
  -> 视图样式跟随视图文件

第五步：拆 Go handlers.go
  -> 按 repo / staging / commit / branch / remote / diff / merge 拆文件

第六步：整理协议类型
  -> 建立 Git command map
  -> 减少 response.data as ...

第七步：整理凭据和文档目录
  -> 敏感信息移出普通 config
  -> docs 按用途重新归档
```

这套顺序的好处是每一步都比较小，也都能单独验证。不会出现“重构一半，项目既跑不了，也回不去”的尴尬状态。

---

## 十五、这次体检带来的一个提醒

写功能时，我们很容易把注意力放在“它能不能跑”上。

这个阶段当然重要。尤其是 IntelliGit 这种同时有 Electron、React、Go、Git 协议、系统文件、远程认证的项目，先把链路打通本身就不容易。

但当功能已经能跑以后，项目会进入另一个阶段：代码开始要求我们给它安排房间。

`MainApp.tsx` 太长，其实是在说：“前端视图该分家了。”

`useAppStore.ts` 太大，其实是在说：“状态和服务该分层了。”

`handlers.go` 太集中，其实是在说：“后端命令该按业务域拆开了。”

两个大 CSS 文件互相覆盖，其实是在说：“样式也需要边界。”

这些提醒都不是坏消息。恰恰相反，它说明项目已经从“验证能不能做”走到了“思考怎么长期维护”的阶段。

对 IntelliGit 来说，这是一个挺关键的拐点。接下来如果能把结构整理好，后面的 AI commit、智能暂存、冲突解决、沙箱测试、分支图这些功能，都会更容易稳稳地长上去。

这次体检没有改动业务代码，但它给后续重构画了一张地图。项目不是乱到不能救，而是到了该收拾、该分层、该让代码重新变得清爽的时候。
