> 本文为山东大学软件学院创新实训项目博客

# IntelliGit 前端主界面结构拆分记录

这次做的是 IntelliGit 前端主界面的一次结构性整理。

在这之前，项目的正式前端界面已经能跑起来，仓库列表、创建仓库、添加仓库、克隆仓库、文件状态、暂存、提交、Diff、历史图、设置页、Push / Pull 等功能都已经陆续接进来了。从功能角度看，这说明项目已经从最早的通信测试界面，走到了比较完整的桌面 Git 客户端雏形。

但功能跑通以后，一个新的问题也变得越来越明显：`MainApp.tsx` 太大了。

它不只是“行数多”，而是同时承担了太多不同层级的职责：

```text
应用启动
主题配置
Ant Design Provider
自动刷新
左侧活动栏
仓库管理面板
顶部工具栏
变更视图
Diff 展示
历史视图
设置页
通知栏
状态栏
大量弹窗和表单交互
```

这篇博客就记录一下这次我是怎么把这个大文件拆开的，以及我对“项目结构要跟着功能一起长”这件事的一点理解。

---

## 一、为什么这次必须先拆 MainApp

在前面的结构体检里，我发现 `MainApp.tsx` 已经超过一千三百行。单纯从数字上看，这当然已经偏长，但真正的问题不在行数本身。

有些文件长一点是可以接受的，比如协议类型、测试用例、静态数据表。如果一个文件虽然长，但内部职责很单一，维护成本未必很高。

`MainApp.tsx` 的问题是另一种：它里面混着好几层不同性质的东西。

比如主题 token 是应用级配置：

```tsx
const ANT_THEME_TOKENS: Record<AppThemeMode, ThemeConfig> = {
  dark: {
    algorithm: antdTheme.darkAlgorithm,
    token: {
      colorPrimary: '#2f81f7',
      colorBgBase: '#0f1218',
      colorBgContainer: '#161b22'
    }
  },
  light: {
    algorithm: antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: '#185fa5',
      colorBgBase: '#f5f7fb',
      colorBgContainer: '#ffffff'
    }
  }
}
```

仓库面板是跨视图布局：

```tsx
function RepoPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  // 仓库列表、添加、创建、克隆、删除、路径检查
}
```

变更页和历史页则是业务视图：

```tsx
function ChangesView() {
  // 暂存区、未暂存区、Diff、提交面板
}

function HistoryView() {
  // 分支列表、Commit Graph、提交详情、Reset / Checkout
}
```

这些内容放在同一个文件里，短期看写起来很快，长期看就会有几个麻烦。

第一，修改边界不清楚。比如我只是想改一下历史视图的 Commit 详情，却要进入整个主界面文件；想改仓库弹窗，也要和主题、状态栏、变更视图待在一起。

第二，后续多人协作容易互相影响。大家都改 `MainApp.tsx`，冲突概率会变高，也更难 review。

第三，后面的重构会缺少落点。比如接下来要拆 store、拆 CSS、调整自动刷新，如果主界面还是一整个大文件，很多东西不知道应该放到哪里。

所以这次我没有一上来就改 store 或 CSS，而是先把前端主界面的骨架拆清楚。我的目标是：先让目录结构能表达业务结构。

---

## 二、保留兼容入口，降低迁移风险

这次拆分的第一步，是处理原来的入口文件：

```text
src/renderer/src/MainApp.tsx
```

因为 `App.tsx` 里原来直接引用的是：

```tsx
import MainApp from './MainApp'
```

如果我直接把这个文件删除，再去大范围改引用，风险会变大，也不利于分步提交。

所以我把原来的 `MainApp.tsx` 收缩成一个兼容导出壳：

```tsx
export { default } from './app/MainApp'
```

这样外部引用路径不变，真正的实现则移动到：

```text
src/renderer/src/app/MainApp.tsx
```

这个小处理看起来不起眼，但它有一个好处：迁移内部结构时，不会影响外部模块怎么使用主界面。也就是说，外面还认为自己在用 `./MainApp`，里面已经变成了新的目录结构。

---

## 三、把应用级逻辑放进 app 目录

我先新增了一个 `app` 目录：

```text
src/renderer/src/app/
  AppProviders.tsx
  MainApp.tsx
  appTheme.ts
  types.ts
  useAutoRefresh.ts
  useThemeMode.ts
  viewOptions.tsx
  README.md
```

这个目录的定位是“应用级装配层”。它不负责具体页面，也不负责某个业务组件，而是负责整个前端应用运行起来所需要的公共壳子。

主题 token 被拆到了 `appTheme.ts`：

```tsx
export const ANT_THEME_TOKENS: Record<AppThemeMode, ThemeConfig> = {
  dark: {
    algorithm: antdTheme.darkAlgorithm,
    token: {
      colorPrimary: '#2f81f7',
      colorBgBase: '#0f1218',
      colorBgContainer: '#161b22'
    }
  },
  light: {
    algorithm: antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: '#185fa5',
      colorBgBase: '#f5f7fb',
      colorBgContainer: '#ffffff'
    }
  }
}
```

主题状态被拆到了 `useThemeMode.ts`：

```tsx
export function useThemeMode() {
  const [themeMode, setThemeMode] = useState<AppThemeMode>(() => {
    const saved = window.localStorage.getItem('intelligit.theme')
    return saved === 'light' || saved === 'dark' ? saved : 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    document.body.dataset.theme = themeMode
    window.localStorage.setItem('intelligit.theme', themeMode)
  }, [themeMode])

  const toggleTheme = useCallback(() => {
    setThemeMode((mode) => (mode === 'dark' ? 'light' : 'dark'))
  }, [])

  return { themeMode, toggleTheme }
}
```

自动刷新也被拆成了 hook：

```tsx
export function useAutoRefresh(
  repoPath: string | undefined,
  refreshAllLocal: () => Promise<void>
): void {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (repoPath) {
      timerRef.current = setInterval(() => {
        refreshAllLocal()
      }, AUTO_REFRESH_INTERVAL)
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [repoPath, refreshAllLocal])
}
```

这里我没有改变原来的刷新策略，只是把它从主组件里拿出来。因为这次的目标是结构拆分，不是顺手重写刷新机制。自动刷新本身偏重的问题，后续还会作为独立问题继续优化。

Provider 也单独拆出来：

```tsx
export function AppProviders({ children, themeMode }: AppProvidersProps): JSX.Element {
  return (
    <ConfigProvider theme={ANT_THEME_TOKENS[themeMode]}>
      <AntApp className="ig-ant-root">{children}</AntApp>
    </ConfigProvider>
  )
}
```

拆完以后，新的 `app/MainApp.tsx` 就清爽了很多：

```tsx
function MainApp(): JSX.Element {
  const configLoaded = useAppStore((state) => state.configLoaded)
  const loadConfig = useAppStore((state) => state.loadConfig)
  const activeView = useAppStore((state) => state.activeView)
  const loading = useAppStore((state) => state.loading)
  const currentRepo = useAppStore((state) => state.currentRepo)
  const refreshAllLocal = useAppStore((state) => state.refreshAllLocal)

  const { themeMode, toggleTheme } = useThemeMode()
  const [repoPanelOpen, setRepoPanelOpen] = useState(false)

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useAutoRefresh(currentRepo?.path, refreshAllLocal)

  return (
    <AppProviders themeMode={themeMode}>
      <AppShell
        activeView={activeView}
        currentRepoPath={currentRepo?.path}
        loading={loading}
        repoPanelOpen={repoPanelOpen}
        themeMode={themeMode}
        onToggleRepoPanel={toggleRepoPanel}
        onToggleTheme={toggleTheme}
      />
    </AppProviders>
  )
}
```

这个文件现在的职责就比较明确了：它是“启动和装配”，不再是“什么都做”。

---

## 四、把工作台外壳放进 layout 目录

拆完应用级逻辑以后，我新增了 `layout` 目录：

```text
src/renderer/src/layout/
  AppShell/
  ActivityRail/
  RepoPanel/
  Toolbar/
  NotificationBar/
  StatusBar/
  README.md
```

这里放的是跨视图的工作台结构。

`AppShell` 是整个正式工作台的骨架：

```tsx
function AppShell({
  activeView,
  currentRepoPath,
  loading,
  repoPanelOpen,
  themeMode,
  onToggleRepoPanel,
  onToggleTheme
}: AppShellProps): JSX.Element {
  return (
    <div className={`ig-app theme-${themeMode}`}>
      <Toolbar />
      <NotificationBar />
      {loading && currentRepoPath && (
        <div className="ig-loading-bar">
          <div className="ig-loading-bar-inner" />
        </div>
      )}
      <div className="ig-workbench">
        <ActivityRail
          repoPanelOpen={repoPanelOpen}
          themeMode={themeMode}
          onToggleRepoPanel={onToggleRepoPanel}
          onToggleTheme={onToggleTheme}
        />
        <RepoPanel isOpen={repoPanelOpen} onClose={onToggleRepoPanel} />
        <main className="ig-content">
          {activeView === 'changes' && <ChangesView />}
          {activeView === 'history' && <HistoryView />}
          {activeView === 'settings' && <SettingsView key={currentRepoPath || 'settings'} />}
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
```

这个结构比原来更容易看懂：顶部工具栏、通知、工作台主体、底部状态栏都在这里组装，具体业务视图由 `activeView` 控制。

`ActivityRail` 负责左侧导航、仓库入口和主题切换：

```tsx
function ActivityRail({
  themeMode,
  repoPanelOpen,
  onToggleRepoPanel,
  onToggleTheme
}: ActivityRailProps): JSX.Element {
  const activeView = useAppStore((state) => state.activeView)
  const setActiveView = useAppStore((state) => state.setActiveView)
  const fileStatuses = useAppStore((state) => state.fileStatuses)
  const changeCount = fileStatuses.filter(
    (file) => file.staging !== ' ' || file.worktree !== ' '
  ).length

  return (
    <nav className="ig-activity-rail" aria-label="主导航">
      {/* 仓库入口、视图入口、主题切换 */}
    </nav>
  )
}
```

`Toolbar` 负责仓库名、分支、刷新、Pull、Push 这些全局操作。

`RepoPanel` 负责仓库管理。这个组件目前仍然比较重，因为它包含创建、添加、克隆、删除以及路径校验逻辑。虽然这次已经把它从 `MainApp.tsx` 里拿出来了，但后续它还可以继续细拆：

```text
RepoPanel/
  RepoList.tsx
  RepoManageModal.tsx
  RemoveRepoModal.tsx
```

这也是我这次拆分里的一个原则：先把第一层边界拉出来，不强迫一次性把所有组件拆到最细。重构如果一次切太碎，反而容易引入行为变化。

---

## 五、把业务页面放进 views 目录

原来项目里已经有：

```text
src/renderer/src/views/
```

但是里面只有 README，实际视图还都写在 `MainApp.tsx` 里。这次我把三个正式业务视图都移动了进去：

```text
src/renderer/src/views/
  ChangesView/
  HistoryView/
  SettingsView/
```

`ChangesView` 负责变更工作区：

```text
已暂存文件
未暂存文件
当前文件 Diff
提交信息输入框
提交按钮
提交前沙箱验证开关
```

它现在通过 selector 精确订阅自己需要的状态：

```tsx
const fileStatuses = useAppStore((state) => state.fileStatuses)
const addFile = useAppStore((state) => state.addFile)
const addAll = useAppStore((state) => state.addAll)
const removeFile = useAppStore((state) => state.removeFile)
const createCommit = useAppStore((state) => state.createCommit)
const operationLoading = useAppStore((state) => state.operationLoading)
const currentRepo = useAppStore((state) => state.currentRepo)
const selectedFilePath = useAppStore((state) => state.selectedFilePath)
const selectFile = useAppStore((state) => state.selectFile)
```

这里有个小变化值得一提：原来不少组件是直接：

```tsx
const { fileStatuses, addFile, addAll } = useAppStore()
```

这种写法虽然方便，但订阅范围太粗。现在拆文件时顺手改成 selector，不改变 store 结构，但让每个组件订阅的状态更清楚。后续真正拆 store 的时候，也会更容易迁移。

`HistoryView` 负责历史视图：

```text
左侧分支列表
中间 Commit Graph
右侧 Commit 详情
Checkout 到指定 Commit
Reset 到指定 Commit
```

这里暂时保留了原来的简化 lane 分配逻辑：

```tsx
const laneMap = new Map<string, number>()
let nextLane = 0
allCommitHistory.forEach((commit) => {
  if (!laneMap.has(commit.hash)) {
    const refLane =
      commit.refs && commit.refs.length > 0
        ? commit.refs[0]
        : commit.parentHashes?.[0] || commit.hash
    if (!laneMap.has(refLane)) laneMap.set(refLane, nextLane++ % GRAPH_COLORS.length)
    laneMap.set(commit.hash, laneMap.get(refLane) || 0)
  }
})
```

这部分后续还可以单独抽成纯函数，比如：

```text
HistoryView/
  commitGraph.ts
```

但这次我没有继续拆，因为当前目标还是把大文件职责搬出来，而不是重新设计 commit graph 算法。

`SettingsView` 则负责仓库设置：

```text
仓库信息
提交身份
HTTP(S) 远程配置
SSH 远程配置
认证信息表单
```

这里也保留了原有行为。需要注意的是，凭据现在仍然会进入普通配置文件，这是原结构体检里的另一个高优先级问题，但不属于这次问题 1 的处理范围。

---

## 六、把可复用 UI 和纯函数拆出来

除了页面和布局，我还从原来的 `MainApp.tsx` 里拆出了几个更小的复用点。

组件目录现在有：

```text
src/renderer/src/components/
  DiffView/
  FileStatusBadge/
  RepoAvatar/
```

`DiffView` 只负责把当前选中文件的 patch 数据渲染出来：

```tsx
function DiffView(): JSX.Element {
  const workdirDiff = useAppStore((state) => state.workdirDiff)
  const selectedFilePath = useAppStore((state) => state.selectedFilePath)

  if (!selectedFilePath) return <div className="ig-diff-empty">← 选择文件查看差异</div>
  if (!workdirDiff || workdirDiff.filePatches.length === 0) {
    return <div className="ig-diff-empty">无差异内容</div>
  }

  return (
    <div className="ig-diff-scroll">
      {/* patch chunks */}
    </div>
  )
}
```

`FileStatusBadge` 把文件状态码的展示收敛起来：

```tsx
function FileStatusBadge({ code, className = 'ig-file-status-badge' }: FileStatusBadgeProps) {
  return (
    <span className={className} style={{ color: statusColor(code) }}>
      {statusLabel(code)}
    </span>
  )
}
```

对应的状态映射放在 `utils/fileStatus.ts`：

```ts
export function statusColor(code: string): string {
  switch (code) {
    case 'M':
      return 'var(--accent-orange)'
    case 'A':
      return 'var(--accent-green)'
    case 'D':
      return 'var(--accent-red)'
    case '?':
      return 'var(--accent-green)'
    default:
      return 'var(--text-secondary)'
  }
}
```

仓库缩写逻辑也被拆到了 `utils/repoName.ts`：

```ts
export function repoInitials(name: string): string {
  const parts = name
    .replace(/\.git$/i, '')
    .split(/[\s._-]+/)
    .filter(Boolean)

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }

  return (parts[0] || name || 'IG').slice(0, 2).toUpperCase()
}
```

这些小拆分的意义在于：以后同样的展示逻辑不需要在文件列表、仓库菜单、状态栏里到处复制。小工具和小组件稳定下来以后，业务视图就会更专注。

---

## 七、给每个目录补 README

这次除了拆代码，我还给每个新增的前端目录补了简短 README。

新增的说明文件包括：

```text
src/renderer/src/app/README.md
src/renderer/src/layout/README.md
src/renderer/src/layout/AppShell/README.md
src/renderer/src/layout/ActivityRail/README.md
src/renderer/src/layout/RepoPanel/README.md
src/renderer/src/layout/Toolbar/README.md
src/renderer/src/layout/NotificationBar/README.md
src/renderer/src/layout/StatusBar/README.md
src/renderer/src/components/DiffView/README.md
src/renderer/src/components/FileStatusBadge/README.md
src/renderer/src/components/RepoAvatar/README.md
src/renderer/src/views/ChangesView/README.md
src/renderer/src/views/HistoryView/README.md
src/renderer/src/views/SettingsView/README.md
src/renderer/src/utils/README.md
```

比如 `RepoPanel/README.md` 里写的是：

```text
# RepoPanel

仓库管理侧栏，负责仓库列表、创建、添加、克隆、删除和路径校验。
后续可继续拆出表单 modal 与仓库列表子组件。
```

这些 README 不是为了凑文档数量，而是给后续设计留一个“边界提示”。以后再加功能时，可以先看这个目录到底负责什么，避免又把业务逻辑塞回一个巨型文件里。

我觉得这是团队项目里很实用的一点：目录名只能说明一半，README 可以说明“这里应该放什么、不应该放什么”。

---

## 八、这次没有顺手改什么

这次我刻意没有把所有问题一起处理。

比如，`useAppStore.ts` 仍然是一个大 store。它确实需要拆，但这是另一个问题。如果在拆组件的同时又重构 store，很容易把行为变化和结构变化混在一起，后面出了问题不好定位。

CSS 也没有搬。现在样式仍然由入口统一引入：

```tsx
import './assets/main.css'
import './assets/features.css'
```

虽然 CSS 分层混乱也是一个问题，但这次先保持原样。这样可以先确保拆组件以后界面行为和样式都不变。

`App.tsx` 里的条件 hooks 问题也没有在这次处理。全仓库 lint 现在仍然会因为这个老问题失败：

```text
React Hook "useState" is called conditionally.
React Hooks must be called in the exact same order in every component render
```

它对应的是结构体检清单里的问题 5。后续比较合适的做法是把测试面板拆成 `TestPanel.tsx`，让 `App.tsx` 只负责根据模式选择渲染正式界面或测试界面。

我这次的原则是：问题 1 就只解决问题 1。先把主界面结构拆清楚，再继续拆 store、CSS 和测试面板。

---

## 九、验证结果

拆分完成后，我先跑了完整类型检查：

```bash
npm.cmd run typecheck
```

结果通过：

```text
typecheck:node 通过
typecheck:web  通过
```

然后我对这次改动范围单独跑了 ESLint：

```bash
npx.cmd eslint src/renderer/src/MainApp.tsx src/renderer/src/app src/renderer/src/layout src/renderer/src/views src/renderer/src/components/DiffView src/renderer/src/components/FileStatusBadge src/renderer/src/components/RepoAvatar src/renderer/src/utils
```

结果也是通过。

这里之所以没有说全仓库 lint 通过，是因为项目里原本就存在 `App.tsx` 条件 hooks 问题。这不是本次拆分引入的错误，但它确实还是后续必须处理的硬错误。

---

## 十、总结

这次重构最大的收获，是让我更直观地感受到：一个项目从“能跑”走向“能维护”，中间必须经历一次目录结构重新生长的过程。

早期把所有东西写进 `MainApp.tsx` 是合理的，因为那时候重点是快速验证界面和 Git 链路。但当仓库管理、Diff、历史图、设置页、同步操作都已经出现以后，继续把所有东西塞在一个文件里，就会让代码越来越像一张展开后收不回去的地图。

这次拆完以后，前端主界面的结构变成了：

```text
app/
  -> 应用装配、主题、Provider、全局 hook

layout/
  -> 工作台外壳、导航、工具栏、仓库面板、通知栏、状态栏

views/
  -> 变更视图、历史视图、设置视图

components/
  -> Diff、状态徽标、仓库头像等可复用组件

utils/
  -> 不依赖 React 的纯函数
```

这并不代表前端结构已经彻底完美了。`RepoPanel` 还可以继续拆，`HistoryView` 的图算法可以下沉，CSS 还需要按组件或视图归属重新整理，store 也需要从一个全局大文件拆成更清楚的状态模块。

但至少现在，项目已经有了继续演进的地基。后面再处理 store、CSS、IPC 类型和自动刷新策略时，就不再需要从一个一千多行的大文件里找入口了。

对我来说，这次最重要的经验是：重构不是为了追求“看起来高级”的目录，而是为了让下一次修改能更准确地落在它应该落的位置上。
