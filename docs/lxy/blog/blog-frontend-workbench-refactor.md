> 本文为山东大学软件学院创新实训项目博客

# IntelliGit 前端工作台重构记录

这次我做的是 IntelliGit 前端界面的整体重构。

在这之前，项目里的 Git 功能已经实现了很多：仓库创建、添加、克隆、分支切换、Push、Pull、文件状态刷新、diff 展示、提交历史等功能链路都已经能跑通。但是界面还比较像“功能堆在页面上”，缺少一个真正桌面 Git 客户端应该有的工作台结构。

尤其是仓库选择区域，之前单独占据了最左边一整列。这个布局虽然能用，但视觉上比较笨重，也浪费了横向空间。结合 `docs/czl/intelligit_commit_workspace.html` 和 `docs/czl/intelligit_branch_graph.html` 里的设计，我这次把前端改成了更接近成熟 Git 客户端的结构：

```text
顶部工具栏
  -> 当前仓库、当前分支、命令入口、Fetch / Push / Pull

左侧活动栏
  -> 仓库缩略图、变更、历史、设置、主题切换

中间工作区
  -> 变更视图 / 历史视图 / 设置视图

底部状态栏
  -> 引擎状态、API 状态、当前路径、分支同步状态
```

这篇博客主要记录这次前端工作台重构的实现过程，包括组件库接入、黑夜白天主题、仓库缩略图切换、顶部栏、状态栏，以及我在这个过程中对“前端界面不是摆控件，而是组织工作流”的理解。

---

## 一、为什么要引入 Ant Design

一开始我并不是单纯为了“让按钮好看”才引入组件库。IntelliGit 是一个桌面 Git 工具，界面里面会频繁出现弹窗、下拉菜单、输入框、选择器、提示、加载态、空状态等控件。如果这些东西全部手写，后面会有两个问题：

第一，视觉和交互很难统一。每个按钮、弹窗、菜单都自己写 CSS，很容易出现边距、圆角、颜色、禁用态不一致的问题。

第二，会把精力消耗在基础控件上。项目真正复杂的地方应该是 Git 状态、分支图、diff、同步流程，而不是每次都重新写一个 Modal 或 Dropdown。

所以这次我加入了 Ant Design，并在入口文件引入它的 reset 样式：

```tsx
// src/renderer/src/main.tsx
import 'antd/dist/reset.css'
import './assets/main.css'
import './assets/features.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
```

在主界面中，我集中引入了这次真正用到的组件：

```tsx
import {
  App as AntApp,
  Alert,
  Badge,
  Button,
  ConfigProvider,
  Dropdown,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip,
  theme as antdTheme
} from 'antd'

import {
  BranchesOutlined,
  CheckOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  CodeOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  MoonOutlined,
  PlusOutlined,
  SettingOutlined,
  SunOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
```

这一步做完以后，后面的仓库操作弹窗、分支下拉菜单、顶部工具栏按钮、提示条、主题切换，都可以基于成熟组件来完成。我的理解是：组件库不是替代业务设计，而是把稳定的交互基础先铺好，让自己能把注意力放回 IntelliGit 自己的产品逻辑上。

---

## 二、主题系统：Ant Design Token 和 CSS 变量同时工作

这次重构的一个目标是实现黑夜和白天两套配色。

这里不能只改 CSS，也不能只改 Ant Design 的 token。原因是界面中有两类元素：

一类是 Ant Design 组件，比如 `Button`、`Dropdown`、`Modal`、`Input`。它们主要受 `ConfigProvider` 的主题控制。

另一类是我自己写的工作台结构，比如左侧活动栏、diff 行、commit 图、状态栏。这些部分主要依靠 CSS 变量控制。

所以我做了两层主题配置。

第一层是 Ant Design 的主题 token：

```tsx
type AppThemeMode = 'light' | 'dark'

const ANT_THEME_TOKENS: Record<AppThemeMode, ThemeConfig> = {
  dark: {
    algorithm: antdTheme.darkAlgorithm,
    token: {
      colorPrimary: '#2f81f7',
      colorSuccess: '#1f9d6f',
      colorWarning: '#b7791f',
      colorError: '#e05252',
      borderRadius: 6,
      colorBgBase: '#0f1218',
      colorBgContainer: '#161b22',
      colorBorder: '#303845',
      colorTextBase: '#e8edf4'
    },
    components: {
      Button: { controlHeight: 30, borderRadius: 6 },
      Input: { controlHeight: 30, borderRadius: 6 },
      Modal: { borderRadiusLG: 8 },
      Segmented: { borderRadius: 6 }
    }
  },
  light: {
    algorithm: antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: '#185fa5',
      colorSuccess: '#1d9e75',
      colorWarning: '#ba7517',
      colorError: '#d64545',
      borderRadius: 6,
      colorBgBase: '#f5f7fb',
      colorBgContainer: '#ffffff',
      colorBorder: '#d8dee8',
      colorTextBase: '#1f2937'
    }
  }
}
```

第二层是 CSS 变量，用 `data-theme` 区分：

```css
[data-theme='dark'] {
  --bg-primary: #0f1218;
  --bg-secondary: #161b22;
  --bg-tertiary: #1d2430;
  --border-primary: #303845;
  --text-primary: #e8edf4;
  --text-secondary: #a6b0bf;
  --accent-blue: #2f81f7;
  --accent-green: #1f9d6f;
  --diff-add-bg: rgba(31, 157, 111, 0.14);
  --diff-remove-bg: rgba(224, 82, 82, 0.14);
}

[data-theme='light'] {
  --bg-primary: #f5f7fb;
  --bg-secondary: #ffffff;
  --bg-tertiary: #eef2f7;
  --border-primary: #d8dee8;
  --text-primary: #1f2937;
  --text-secondary: #546179;
  --accent-blue: #185fa5;
  --accent-green: #1d9e75;
  --diff-add-bg: #e9f6ef;
  --diff-remove-bg: #fdeaea;
}
```

主题状态保存在 `localStorage` 中，并同步写到 `html` 和 `body` 上：

```tsx
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
  setThemeMode((mode) => mode === 'dark' ? 'light' : 'dark')
}, [])
```

最后在根组件里通过 `ConfigProvider` 把主题交给 Ant Design：

```tsx
return (
  <ConfigProvider theme={ANT_THEME_TOKENS[themeMode]}>
    <AntApp className="ig-ant-root">
      <div className={`ig-app theme-${themeMode}`}>
        {/* workbench */}
      </div>
    </AntApp>
  </ConfigProvider>
)
```

这部分最大的收获是：主题不是单纯换颜色，而是要让组件库主题和自定义 CSS 主题同步变化。否则就会出现 Ant 组件已经变亮了，但自己写的区域还是黑色，或者反过来的割裂感。

---

## 三、整体布局：从仓库列改成工作台结构

这次布局改动最大的地方，是把原来“仓库选择占左边一整列”的结构改掉。

现在的主布局在 `MainApp` 里非常清晰：

```tsx
return (
  <ConfigProvider theme={ANT_THEME_TOKENS[themeMode]}>
    <AntApp className="ig-ant-root">
      <div className={`ig-app theme-${themeMode}`}>
        <Toolbar />
        <NotificationBar />
        {loading && currentRepo && (
          <div className="ig-loading-bar">
            <div className="ig-loading-bar-inner" />
          </div>
        )}

        <div className="ig-workbench">
          <ActivityRail themeMode={themeMode} onToggleTheme={toggleTheme} />
          <main className="ig-content">
            {activeView === 'changes' && <ChangesView />}
            {activeView === 'history' && <HistoryView />}
            {activeView === 'settings' && (
              <SettingsView key={currentRepo?.path || 'settings'} />
            )}
          </main>
        </div>

        <StatusBar />
      </div>
    </AntApp>
  </ConfigProvider>
)
```

对应的 CSS 是纵向排列：

```css
.ig-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.ig-workbench {
  min-height: 0;
  flex: 1;
  display: flex;
  overflow: hidden;
}

.ig-content {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  background: var(--bg-primary);
}
```

这样做之后，界面变成了更稳定的桌面软件布局：

```text
Toolbar
Workbench
  ActivityRail
  Content
StatusBar
```

仓库不再是一个横向占空间的大列表，而是进入左侧活动栏中的缩略图区域。工作区的宽度被释放出来，diff、提交面板、历史图都能获得更多空间。

---

## 四、仓库缩略图：点击头像切换仓库，点击加号添加仓库

用户提出“选择仓库在最左边占一列不太好看”以后，我把仓库列表改成了类似活动栏中的仓库 dock。

每个仓库用两位缩写显示。比如 `IntelliGit` 会显示成 `IN`，`hello-repo` 会显示成 `HR`。这个缩写通过 `repoInitials` 生成：

```tsx
function repoInitials(name: string): string {
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

左侧活动栏中先放 IntelliGit 的 `IG` 标识，然后放仓库缩略图，再放变更、历史、设置和主题切换：

```tsx
function ActivityRail({
  themeMode,
  onToggleTheme
}: {
  themeMode: AppThemeMode
  onToggleTheme: () => void
}): React.JSX.Element {
  const { activeView, setActiveView, fileStatuses } = useAppStore()
  const changeCount = fileStatuses
    .filter(f => f.staging !== ' ' || f.worktree !== ' ')
    .length

  return (
    <nav className="ig-activity-rail" aria-label="主导航">
      <div className="ig-rail-brand">IG</div>
      <RepoSidebar />
      <div className="ig-rail-divider" />

      {VIEW_OPTIONS.map((item) => (
        <Tooltip key={item.value} title={item.label} placement="right">
          <button
            className={`ig-rail-item ${activeView === item.value ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveView(item.value)}
            aria-label={item.label}
          >
            {item.icon}
          </button>
        </Tooltip>
      ))}

      <div className="ig-rail-spacer" />
      <Tooltip title={themeMode === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}>
        <button className="ig-rail-item" type="button" onClick={onToggleTheme}>
          {themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        </button>
      </Tooltip>
    </nav>
  )
}
```

仓库缩略图本身则由 `RepoSidebar` 渲染：

```tsx
return (
  <aside className="ig-repo-dock" id="repo-sidebar" aria-label="仓库缩略图">
    <div className="ig-repo-thumb-list">
      {repos.map((r) => (
        <Tooltip
          key={r.path}
          title={
            <div className="ig-repo-thumb-tooltip">
              <strong>{r.name}</strong>
              <span>{r.path}</span>
            </div>
          }
          placement="right"
        >
          <button
            className={`ig-repo-thumb ${currentRepo?.path === r.path ? 'active' : ''}`}
            type="button"
            onClick={() => switchRepo(r.path)}
            aria-label={`切换到仓库 ${r.name}`}
          >
            <span>{repoInitials(r.name)}</span>
          </button>
        </Tooltip>
      ))}
    </div>

    <Dropdown menu={{ items: repoMenuItems, onClick: handleRepoMenuClick }}>
      <button className="ig-repo-thumb ig-repo-thumb-add" type="button">
        {loadingAction ? <Spin size="small" /> : <PlusOutlined />}
      </button>
    </Dropdown>
  </aside>
)
```

这里的交互逻辑是：

```text
点击已有仓库缩略图
  -> switchRepo(r.path)
  -> Store 切换 currentRepo
  -> 触发仓库状态刷新

点击加号
  -> 打开 Dropdown
  -> 选择 创建仓库 / 添加仓库 / 克隆仓库
  -> 打开对应 Modal
  -> 调用 createRepo / addRepo / cloneRepo
```

样式上我把仓库缩略图固定为 `34px * 34px`，活动栏固定为 `52px`，这样不会因为仓库名长度变化影响布局：

```css
.ig-activity-rail {
  width: 52px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-primary);
}

.ig-repo-thumb {
  position: relative;
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  color: var(--text-secondary);
  background: var(--bg-primary);
  font-size: 11px;
  font-weight: 800;
  cursor: pointer;
}

.ig-repo-thumb.active {
  color: var(--accent-blue);
  background: var(--surface-active);
  border-color: var(--accent-blue);
}

.ig-repo-thumb.active::after {
  content: '';
  position: absolute;
  right: -6px;
  width: 3px;
  height: 18px;
  border-radius: 999px;
  background: var(--accent-blue);
}
```

这部分改完之后，仓库切换变得更像“工作区入口”，而不是一个很占位置的配置列表。

---

## 五、顶部工具栏：把高频操作放到用户一眼能看到的位置

顶部工具栏这次承担了几个核心信息：

```text
IntelliGit 标识
当前仓库选择器
当前分支选择器
命令入口占位
Fetch / Push / Pull 操作
```

它的实现主要在 `Toolbar` 组件里：

```tsx
function Toolbar(): React.JSX.Element {
  const {
    repos,
    currentRepo,
    currentBranch,
    branches,
    remoteBranches,
    switchRepo,
    pull,
    push,
    refreshAll,
    refreshAllLocal,
    operationLoading,
    checkoutBranch,
    commitsAhead,
    commitsBehind
  } = useAppStore()

  const hasRemote = Boolean(currentRepo?.remoteType && currentRepo.remoteType !== 'none')
  const hasCommitsToPush = hasRemote && commitsAhead > 0 && commitsBehind === 0
  const hasCommitsToPull = hasRemote && commitsBehind > 0
```

仓库选择器使用 `Dropdown + Button`：

```tsx
const repoSwitchItems: MenuProps['items'] = repos.length === 0
  ? [{ key: '__empty', label: '暂无仓库', disabled: true }]
  : repos.map((repo) => ({
    key: repo.path,
    label: (
      <div className="ig-repo-menu-item">
        <span className="ig-repo-menu-avatar">{repoInitials(repo.name)}</span>
        <span className="ig-repo-menu-text">
          <strong>{repo.name}</strong>
          <small>{repo.path}</small>
        </span>
        {currentRepo?.path === repo.path && <CheckOutlined />}
      </div>
    )
  }))
```

顶部渲染出来是这样的：

```tsx
return (
  <header className="ig-toolbar" id="main-toolbar">
    <div className="ig-toolbar-left">
      <div className="ig-topbar-logo">IntelliGit</div>

      <Dropdown
        menu={{
          items: repoSwitchItems,
          onClick: ({ key }) => {
            if (key !== '__empty') switchRepo(String(key))
          }
        }}
        trigger={['click']}
      >
        <Button className="ig-repo-selector" size="small" icon={<FolderOpenOutlined />}>
          {currentRepo ? currentRepo.name : '选择仓库'}
        </Button>
      </Dropdown>

      <div className="ig-command-placeholder">
        <ThunderboltOutlined />
        <span>告诉我你想做什么... (Ctrl K)</span>
      </div>
    </div>
  </header>
)
```

同步按钮则根据仓库是否有远程、ahead/behind 数量自动切换：

```tsx
const hasRemote = Boolean(currentRepo?.remoteType && currentRepo.remoteType !== 'none')
const hasCommitsToPush = hasRemote && commitsAhead > 0 && commitsBehind === 0
const hasCommitsToPull = hasRemote && commitsBehind > 0
```

这次我把顶部工具栏的原则定成：高频信息常驻，低频操作折叠。用户经常需要看当前仓库、当前分支、同步状态，所以它们应该一直可见。创建、添加、克隆仓库虽然重要，但不是每分钟都点，所以放在左侧加号菜单里。

---

## 六、变更视图：文件列表、Diff、提交面板三栏并排

变更视图是 Git 客户端里最重要的视图之一。它要同时回答三个问题：

```text
哪些文件变了？
具体变了什么？
我要怎么提交？
```

所以我把 `ChangesView` 设计成三栏：

```css
.ig-changes-view {
  display: grid;
  grid-template-columns: 240px 1fr 260px;
  height: 100%;
  gap: 1px;
  background: var(--border-primary);
}
```

左侧是文件列表，中间是 diff，右侧是提交面板。中间的 diff 展示单独拆成了 `DiffView`，它从 Store 中读取 `selectedFilePath` 和 `workdirDiff`，然后找到对应文件的 patch：

```tsx
function DiffView(): React.JSX.Element {
  const { selectedFilePath, workdirDiff } = useAppStore()
  const patch = selectedFilePath
    ? workdirDiff?.filePatches.find((p) =>
        p.oldFile === selectedFilePath || p.newFile === selectedFilePath
      )
    : null

  if (!selectedFilePath) {
    return (
      <div className="ig-diff-view">
        <Empty description="选择文件查看差异" />
      </div>
    )
  }

  return (
    <section className="ig-diff-view">
      <div className="ig-diff-header">
        <div className="ig-diff-title">{selectedFilePath}</div>
      </div>
      <div className="ig-diff-scroll">
        {patch?.chunks.map((chunk, idx) => (
          <div className="ig-diff-chunk" key={`${chunk.header}-${idx}`}>
            <div className="ig-diff-hunk-hdr">{chunk.header}</div>
            {chunk.lines.map((line, lineIdx) => (
              <div
                key={`${line.content}-${lineIdx}`}
                className={`ig-diff-line ${
                  line.type === 'add' ? 'added' : line.type === 'delete' ? 'removed' : ''
                }`}
              >
                <span className="ig-diff-ln">{line.newLine || line.oldLine || ''}</span>
                <span className="ig-diff-lc">{line.content}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
```

diff 行的颜色也接入了主题变量：

```css
.ig-diff-line.added {
  background: var(--diff-add-bg);
}

.ig-diff-line.removed {
  background: var(--diff-remove-bg);
}

.ig-diff-ln {
  width: 40px;
  flex-shrink: 0;
  color: var(--text-muted);
  text-align: right;
  padding-right: 8px;
  user-select: none;
}
```

这里我没有把 diff 做成一个普通文本框，而是按 chunk、line、line type 三层结构渲染。这样后面如果要继续做单行暂存、局部提交、行内注释，都有比较清楚的结构基础。

---

## 七、历史视图：分支列表、提交图、详情面板

历史视图参考了 `intelligit_branch_graph.html` 的设计方向，重点是把提交历史和分支关系放在一起看。

布局同样是三栏：

```css
.ig-history-view {
  display: grid;
  grid-template-columns: 200px 1fr 280px;
  height: 100%;
  gap: 1px;
  background: var(--border-primary);
}
```

左侧是分支列表，中间是提交图，右侧是提交详情。历史图中我先做了一版轻量的 lane 计算，让每条分支有固定颜色：

```tsx
const branchColors = [
  'var(--accent-blue)',
  'var(--accent-green)',
  'var(--accent-purple)',
  'var(--accent-orange)'
]

const laneMap = new Map<string, number>()
branches.forEach((branch, index) => {
  laneMap.set(branch.name, index % branchColors.length)
})
```

提交项中显示分支点、提交标题、作者、时间和 hash：

```tsx
<button
  className={`ig-graph-row ${selectedCommit?.hash === commit.hash ? 'active' : ''}`}
  type="button"
  onClick={() => setSelectedCommit(commit)}
>
  <div className="ig-graph-lanes">
    <span
      className="ig-graph-node"
      style={{ backgroundColor: branchColors[laneIndex] }}
    />
  </div>
  <div className="ig-commit-summary">
    <strong>{commit.subject}</strong>
    <span>{commit.authorName} · {commit.relativeTime}</span>
  </div>
  <code>{commit.hash.slice(0, 7)}</code>
</button>
```

右侧详情面板则用于展示当前选中 commit 的完整信息。这样用户不是只能看到一串提交列表，而是可以在同一屏里完成：

```text
选分支
看提交图
点提交
看详情
```

这部分现在还是一个基础版本，但结构已经比较适合继续扩展，比如后面可以加 Cherry-pick、Revert、分支比较、提交搜索等操作。

---

## 八、通知栏和底部状态栏

为了让界面更像完整的桌面工具，我这次补上了通知栏和底部状态栏。

通知栏用 Ant Design 的 `Alert` 实现，只在有错误或提示时出现：

```tsx
function NotificationBar(): React.JSX.Element | null {
  const { error, clearError } = useAppStore()

  if (!error) return null

  return (
    <Alert
      className="ig-notification-bar"
      type="error"
      message={error}
      closable
      onClose={clearError}
      showIcon
    />
  )
}
```

底部状态栏则常驻显示运行状态：

```tsx
function StatusBar(): React.JSX.Element {
  const { currentRepo, currentBranch, commitsAhead, commitsBehind } = useAppStore()

  return (
    <footer className="ig-statusbar">
      <div className="ig-statusbar-left">
        <span>引擎就绪</span>
        <span>API 已连接</span>
        {currentRepo && <span>{currentRepo.path}</span>}
      </div>
      <div className="ig-statusbar-right">
        {currentBranch && <span>{currentBranch}</span>}
        <span>↑ {commitsAhead}</span>
        <span>↓ {commitsBehind}</span>
      </div>
    </footer>
  )
}
```

状态栏的价值不是放很多按钮，而是让用户始终知道当前应用处于什么上下文：

```text
现在打开的是哪个仓库？
当前分支是什么？
有没有本地领先或远程领先？
底层服务是否正常？
```

这些信息如果散落在界面各处，用户需要自己找。放到底部以后，它就成了一个稳定的上下文提示区。

---

## 九、这次重构后的验证

完成前端重构后，我做了几类检查。

首先是 Web 端 TypeScript 类型检查：

```powershell
npm.cmd run typecheck:web
```

然后针对这次主要修改的前端文件运行 ESLint：

```powershell
npx.cmd eslint src/renderer/src/MainApp.tsx src/renderer/src/main.tsx
```

最后运行项目构建：

```powershell
npm.cmd run build
```

这几项都通过了。完整的 `npm.cmd run lint` 在旧文件中仍然会遇到一些历史遗留问题，比如 `App.tsx` 里的条件 Hook 和一些已有的 Prettier 提示，但这些不是这次工作台重构新增的问题。

---

## 十、这次前端重构的收获

这次改完以后，我对前端界面有几个比较明确的认识。

第一，成熟组件库不是为了少写代码，而是为了让交互行为稳定。比如 Modal、Dropdown、Tooltip、Button 这些控件，如果每个都自己写，很容易在焦点、禁用态、加载态、键盘操作上出现细节问题。引入 Ant Design 以后，我可以把更多精力放到 Git 工作流本身。

第二，桌面工具的设计重点是信息架构。仓库选择不一定非要占一整列，它更适合作为工作区入口放进活动栏。顶部栏应该放高频上下文，底部栏应该放状态信息，中间区域才留给真正的工作内容。

第三，明暗主题要同时考虑组件库和自定义样式。只改一边都会割裂。`ConfigProvider` 负责 Ant Design，`data-theme` 和 CSS 变量负责自定义工作台，两者配合以后，主题切换才会完整。

第四，固定尺寸比“看起来灵活”更重要。像活动栏、仓库缩略图、状态栏、工具栏按钮这些地方，我都尽量给了稳定尺寸。这样仓库名变长、变更数量变化、主题切换时，布局不会来回跳动。

第五，前端组件应该只做界面组织，不应该把 Git 业务逻辑重新写一遍。比如切换仓库仍然调用 Store 的 `switchRepo`，同步状态仍然来自 `commitsAhead` 和 `commitsBehind`，提交、Push、Pull 也还是沿用已经实现好的 Store 方法。这样前端重构不会破坏已有 Git 功能。

这次工作本质上不是把页面“美化一下”，而是把 IntelliGit 从一个功能页面整理成了一个更像桌面 Git 客户端的工作台。后面继续做分支图、冲突解决、AI 提交信息、历史搜索时，也能在这个结构上继续扩展。
