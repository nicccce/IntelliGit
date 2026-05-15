> 本文为山东大学软件学院创新实训项目博客

# IntelliGit 前端 CSS 分层与样式边界重构

这次做的是 IntelliGit 前端样式结构的一次彻底整理。

在前面几轮重构中，前端代码已经发生了很大的变化：原来庞大的 `MainApp.tsx` 被拆成了 `app/`、`layout/`、`views/`、`components/` 等目录；原来的全局 store 也被拆成多个 Zustand store，并进一步整理出了 selector 层、view model 层和 service workflow 层。到这个阶段，React 组件结构和状态结构已经比最早清楚很多。

但还有一个问题一直没有真正处理干净：CSS。

虽然组件已经被拆开了，但样式仍然集中在两个全局文件里：

```text
src/renderer/src/assets/main.css
src/renderer/src/assets/features.css
```

这两个文件同时在 `main.tsx` 里引入：

```tsx
import './assets/main.css'
import './assets/features.css'
```

这意味着一个很尴尬的情况：代码结构已经进入组件化阶段，但样式结构还停留在“大锅饭”阶段。组件拆开以后，样式没有跟着组件走，导致维护时经常要回到两个超大的 CSS 文件里找规则。

这篇博客就记录一下，我是怎么把这两个全局 CSS 桶拆掉，改成“全局基础层 + CSS Modules 局部样式”的。

---

## 一、问题不只是 CSS 文件太长

最开始看这个问题时，最直观的现象当然是行数。

当时这两个文件大概是：

```text
main.css      1669 行
features.css 1483 行
```

单看数字已经不短，但真正的问题不是“文件长”。有些 CSS 文件长一点也可以接受，比如完整的设计系统、主题 token 或者第三方组件覆盖。如果职责单一，文件长不一定难维护。

这两个文件的问题在于：它们混合了太多不同层级的样式。

`main.css` 里既有：

```text
全局 reset
CSS 变量
旧 Sidecar 测试面板样式
旧首页样式
正式应用样式
视图样式
组件样式
一些已经不再使用的旧 class
```

`features.css` 里又继续定义了大量 `.ig-*` 正式界面样式，并且和 `main.css` 出现了不少重复 class。

例如这些 class 在两个文件里都出现过：

```text
ig-app
ig-toolbar
ig-content
ig-changes-view
ig-file-item
ig-commit-panel
ig-history-view
ig-settings-view
ig-statusbar
```

这就带来了一个更本质的问题：样式依赖加载顺序。

因为 `features.css` 在 `main.css` 后面引入，所以后者定义的一些样式会被前者覆盖。项目能正常显示，不是因为样式边界清楚，而是因为当前引入顺序刚好满足了覆盖关系。

这类结构短期可以工作，长期会越来越危险。后续如果有人调整 import 顺序、删除某段看似无用的 CSS、或者新增一个同名 class，都可能影响另一个页面。

---

## 二、样式结构没有跟上组件结构

这次重构前，前端代码结构其实已经比较清楚了：

```text
src/renderer/src/app/
src/renderer/src/layout/
src/renderer/src/views/
src/renderer/src/components/
src/renderer/src/dev/
```

这些目录分别承担不同职责：

```text
app        应用装配层
layout     工作台骨架
views      业务视图
components 共享组件
dev        开发测试面板
```

但样式却没有对应迁移。比如 `RepoPanel` 组件已经在：

```text
src/renderer/src/layout/RepoPanel/index.tsx
```

但它的样式仍然散落在 `main.css` 和 `features.css` 中。`ChangesView`、`HistoryView`、`SettingsView` 也是一样。

这会让维护者遇到几个问题。

第一，组件和样式的所有权不一致。改一个组件时，不知道应该去哪里改样式。

第二，删除组件时很难判断对应样式能不能删。一个 class 在 CSS 里看起来还在，但可能已经没有任何 TSX 文件使用。

第三，样式名字虽然加了 `.ig-*` 前缀，但仍然是全局命名空间。只要 class 名相同，就可能互相影响。

所以这次的目标不是把 `main.css` 拆成 `base.css`、`views.css`、`components.css` 这么简单。那样只是把一个大桶拆成几个中桶，本质上还是全局 CSS。

我这次想做的是让样式边界和组件边界一致：

```text
组件在哪里，样式就在哪里。
视图在哪里，样式就在哪里。
全局 CSS 只保留真正全局的东西。
```

---

## 三、先建立新的全局样式入口

重构的第一步，是先处理入口。

原来的 `main.tsx` 是：

```tsx
import 'antd/dist/reset.css'
import './assets/main.css'
import './assets/features.css'
```

整改后变成：

```tsx
import 'antd/dist/reset.css'
import './assets/styles/index.css'
```

新增目录：

```text
src/renderer/src/assets/styles/
```

里面只保留全局基础层：

```text
index.css
reset.css
tokens.css
antd.css
```

`index.css` 现在是：

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

@import './reset.css' layer(reset);
@import './tokens.css' layer(tokens);
@import './antd.css' layer(antd);
```

这里的重点是：`index.css` 不再引入任何业务页面样式。

它只负责三类事情。

第一，基础 reset：

```text
box-sizing
html / body / #root 高度
body 字体和背景
控件继承字体
```

第二，主题 token：

```text
暗色主题变量
亮色主题变量
间距
圆角
阴影
字体
动效曲线
Diff 添加 / 删除颜色
```

第三，确实需要全局处理的 Ant Design 根样式：

```css
.ig-ant-root,
.ig-ant-root .ant-app {
  height: 100%;
}
```

这样一来，全局 CSS 的职责就收窄了。它不再参与具体页面布局，也不再定义 `Toolbar`、`RepoPanel`、`ChangesView` 这类业务样式。

---

## 四、把测试面板从正式应用样式中隔离出来

在正式应用之外，项目里还有一个开发阶段的 Sidecar 通信测试面板：

```text
src/renderer/src/dev/SidecarTestPanel/index.tsx
```

它原来使用的是一套 `.app-*`、`.btn-*`、`.history-*` 等全局 class：

```text
app-container
app-header
app-main
dashboard-grid
status-panel
input-panel
result-panel
btn
btn-primary
history-item
app-footer
```

这些样式也放在 `main.css` 中。也就是说，一个只在 `dev:test` 模式下使用的测试面板，会把自己的样式放进正式应用的全局样式入口。

这显然不合理。

所以这次新增了：

```text
src/renderer/src/dev/SidecarTestPanel/SidecarTestPanel.module.css
```

然后在组件里改成：

```tsx
import styles from './SidecarTestPanel.module.css'
```

原来的：

```tsx
<div className="app-container">
```

改成：

```tsx
<div className={styles.container}>
```

状态类也不再拼接全局 class，而是通过一个小工具组合 CSS Module class：

```tsx
className={classNames(
  styles.connectionPill,
  loading ? styles.connectionPillLoading : styles.connectionPillIdle
)}
```

这样测试面板的样式就完全归它自己所有，不会再和正式界面共享全局命名空间。

---

## 五、迁移 layout：先稳住应用骨架

正式应用里，我先迁移的是 `layout` 层。

这一层负责整个工作台的骨架，如果它不稳定，其他视图迁移就很难判断问题出在哪里。迁移范围包括：

```text
src/renderer/src/layout/AppShell/AppShell.module.css
src/renderer/src/layout/Toolbar/Toolbar.module.css
src/renderer/src/layout/ActivityRail/ActivityRail.module.css
src/renderer/src/layout/RepoPanel/RepoPanel.module.css
src/renderer/src/layout/StatusBar/StatusBar.module.css
src/renderer/src/layout/NotificationBar/NotificationBar.module.css
```

例如 `AppShell` 负责：

```text
应用根容器
workbench 主布局
顶部 loading bar
主内容滚动区
```

`Toolbar` 负责：

```text
顶部工具栏
项目名
当前仓库名
分支选择器
命令输入占位区
Fetch / Push / Pull 操作按钮区域
```

`ActivityRail` 负责：

```text
左侧活动栏
仓库按钮
视图切换按钮
变更数量 Badge
主题切换按钮
```

`RepoPanel` 是这次 layout 迁移中最复杂的部分。它不只是一个列表，还包含：

```text
面板展开 / 收起
拖拽调整宽度
仓库列表项
当前仓库选中态
删除按钮 hover 状态
创建仓库弹窗
添加仓库弹窗
克隆仓库弹窗
路径检查 Alert
窄屏时的绝对定位
```

这些内容以前分散在全局 `.ig-repo-*`、`.ig-panel-*`、`.ig-form-group`、`.ig-path-alert` 等 class 里。迁移后，它们全部收进：

```text
src/renderer/src/layout/RepoPanel/RepoPanel.module.css
```

这一步的好处很明显：以后改仓库面板，就进入 `RepoPanel` 目录；不会再误伤 `SettingsView` 里的表单，也不会依赖某个全局 `.ig-form-group`。

---

## 六、迁移 ChangesView：让视图样式跟着视图走

`ChangesView` 是 IntelliGit 当前最核心的视图之一，它包含：

```text
已暂存文件列表
未暂存文件列表
Diff 外壳
Diff 内容
提交面板
```

这次把它拆成了几份局部样式：

```text
src/renderer/src/views/ChangesView/ChangesView.module.css
src/renderer/src/views/ChangesView/FileSection.module.css
src/renderer/src/views/ChangesView/DiffPane.module.css
src/renderer/src/views/ChangesView/CommitPanel.module.css
```

对应关系也很清楚：

```text
ChangesView.module.css   -> 三栏布局和空状态
FileSection.module.css   -> 文件分组、文件列表、选中态
DiffPane.module.css      -> Diff 区域外壳和标题
CommitPanel.module.css   -> 提交信息、AI 按钮、沙箱开关、提交按钮
```

共享的 Diff 内容渲染没有放在 `ChangesView` 目录里，而是继续归属于共享组件：

```text
src/renderer/src/components/DiffView/DiffView.module.css
```

因为 `DiffView` 的职责不是“ChangesView 的某个 div”，而是一个可以复用的 Diff 展示组件。它自己的样式包括：

```text
空状态
滚动区域
二进制文件提示
hunk header
added / removed 行背景
行号列
内容列
```

这一步完成以后，`ChangesView` 的样式边界基本就和组件结构一致了。

---

## 七、迁移 HistoryView：把提交图和详情面板分开

`HistoryView` 的结构也比较典型：

```text
左侧分支列表
中间 Commit Graph
右侧 Commit 详情
```

所以样式也按这个结构拆：

```text
src/renderer/src/views/HistoryView/HistoryView.module.css
src/renderer/src/views/HistoryView/BranchPanel.module.css
src/renderer/src/views/HistoryView/CommitGraph.module.css
src/renderer/src/views/HistoryView/CommitDetail.module.css
```

`HistoryView.module.css` 只管整体三栏布局和右侧详情容器。

`BranchPanel.module.css` 负责：

```text
分支面板
分支搜索框
分支列表
当前分支 current 状态
本地 / 远程分支颜色点
```

`CommitGraph.module.css` 负责：

```text
提交图区域
提交列表
提交行 hover
选中 commit
hash 样式
提交 meta 信息
```

`CommitDetail.module.css` 负责：

```text
未选择 commit 的空状态
commit hash
commit message
作者和时间
变更文件列表
Checkout / Reset 操作区
Reset 确认面板
```

这样拆完以后，如果后续要增强 commit graph，比如添加 tag、远程分支引用、合并线样式，就只需要进入 `CommitGraph`；如果要改 reset 面板，就进入 `CommitDetail`。它们不再挤在同一个全局 CSS 文件里。

---

## 八、迁移 SettingsView：避免复用模糊的全局表单样式

`SettingsView` 的样式以前也依赖一些通用全局 class：

```text
ig-settings-view
ig-settings-section
ig-settings-info
ig-form-group
ig-hint
ig-remote-detail
ig-remote-type-group
```

其中最容易出问题的是 `ig-form-group`。

这个 class 在设置页里用，在仓库面板弹窗里也用。短期看可以复用，长期看会模糊边界。比如设置页里的输入框宽度、间距、背景需要调整时，很可能影响仓库弹窗里的表单。

所以这次给 `SettingsView` 单独新增：

```text
src/renderer/src/views/SettingsView/SettingsView.module.css
```

它自己持有：

```text
页面最大宽度
分区边框
仓库信息展示
表单组
提示文案
远程仓库配置区域
Segmented 覆盖
Input / Password 覆盖
```

仓库面板的表单样式则留在 `RepoPanel.module.css` 中。

这看起来会有一点重复，但这种重复是有价值的。因为这两个地方虽然都叫“表单”，但它们属于不同页面上下文，未来演化方向也不一定一样。用一个全局 `.ig-form-group` 强行复用，反而会制造隐性耦合。

---

## 九、共享组件也要有自己的样式所有权

除了视图和布局，这次还迁移了几个共享组件：

```text
src/renderer/src/components/FileStatusBadge/FileStatusBadge.module.css
src/renderer/src/components/RepoAvatar/RepoAvatar.module.css
src/renderer/src/components/DiffView/DiffView.module.css
```

`FileStatusBadge` 原来默认 class 是：

```tsx
className = 'ig-file-status-badge'
```

这意味着组件默认依赖一个全局 class。整改后变成：

```tsx
import styles from './FileStatusBadge.module.css'

function FileStatusBadge({
  code,
  className = styles['ig-file-status-badge']
}: FileStatusBadgeProps) {
  return (
    <span className={className} style={{ color: statusColor(code) }}>
      {statusLabel(code)}
    </span>
  )
}
```

这样组件仍然支持外部传入 `className`，但默认样式已经回到组件目录内部。

`RepoAvatar` 也是类似，从全局 `.ig-repo-initials` 改成自己的 CSS Module。

这一步让我觉得很重要：共享组件如果默认依赖全局样式，其实就不是真正自包含的组件。组件自带默认样式，才更符合后续复用和迁移的需要。

---

## 十、增加样式边界检查，防止结构回退

重构完成以后，如果没有自动检查，项目很容易慢慢退回旧状态。

比如后面有人为了快，重新在 `main.tsx` 里写：

```tsx
import './assets/features.css'
```

或者在某个 view 里直接引入：

```tsx
import '../../assets/some-global.css'
```

这类写法单次看可能问题不大，但积累起来就会把这次重构的成果冲掉。

所以这次新增了一个脚本：

```text
scripts/check-renderer-styles.mjs
```

它主要检查几件事：

```text
main.tsx 只能 import antd reset 和 assets/styles/index.css
禁止恢复 assets/main.css
禁止恢复 assets/features.css
UI 文件不能直接 import assets 下的全局 CSS
components / layout / views / dev 只能 import 本地 .module.css
```

并把它接进了 `lint`：

```json
"lint": "eslint --cache . && npm run check:renderer-boundaries && npm run check:renderer-styles",
"check:renderer-styles": "node scripts/check-renderer-styles.mjs"
```

这和前面做 store 订阅边界检查的思路是一样的：结构性约定不能只靠记忆，最好变成自动检查。

---

## 十一、为什么没有继续保留 legacy.css

这次迁移过程中，其实有一个比较省事的选择：把 `main.css` 和 `features.css` 合并成一个 `legacy.css`，然后后面慢慢删。

但我最后没有这么做。

原因是，如果保留一个 `legacy.css`，它很可能会变成新的垃圾桶。短期看它降低迁移压力，长期看却会让问题继续存在：

```text
不知道哪些样式还在用
新样式可能继续往 legacy.css 里塞
组件样式所有权仍然不彻底
删除旧样式仍然没有明确时间点
```

所以这次选择直接删除：

```text
src/renderer/src/assets/main.css
src/renderer/src/assets/features.css
```

然后把需要保留的样式平移到对应 CSS Module 中。这个过程工作量更大，但结果更干净。

从构建结果看，renderer CSS 产物也从原来大约：

```text
92 KB
```

下降到大约：

```text
43 KB
```

这说明旧全局桶里的大量无用样式确实没有再进入最终产物。

---

## 十二、验证结果

这次重构后，我跑了下面这些检查：

```text
npm.cmd run check:renderer-styles
npm.cmd run check:renderer-boundaries
npm.cmd run typecheck
npm.cmd run build
git diff --check
npm.cmd run lint
```

结果都是通过。

其中 `npm.cmd run lint` 仍然会输出一些已有的 prettier warning，主要集中在 main process 和 sidecar 相关文件，比如：

```text
scripts/build-sidecar.mjs
src/main/core/SidecarManager.ts
src/main/ipc/configHandlers.ts
src/main/ipc/gitHandlers.ts
src/preload/index.ts
```

这些 warning 是项目里已有的格式提示，不是这次 CSS 重构引入的错误。本次新增的样式边界检查和 TypeScript 检查都通过了。

---

## 十三、这次重构后的项目状态

现在前端样式结构大致变成：

```text
src/renderer/src/assets/styles/
  index.css
  reset.css
  tokens.css
  antd.css

src/renderer/src/layout/
  AppShell/AppShell.module.css
  Toolbar/Toolbar.module.css
  ActivityRail/ActivityRail.module.css
  RepoPanel/RepoPanel.module.css
  StatusBar/StatusBar.module.css
  NotificationBar/NotificationBar.module.css

src/renderer/src/views/
  ChangesView/ChangesView.module.css
  ChangesView/FileSection.module.css
  ChangesView/DiffPane.module.css
  ChangesView/CommitPanel.module.css
  HistoryView/HistoryView.module.css
  HistoryView/BranchPanel.module.css
  HistoryView/CommitGraph.module.css
  HistoryView/CommitDetail.module.css
  SettingsView/SettingsView.module.css

src/renderer/src/components/
  DiffView/DiffView.module.css
  FileStatusBadge/FileStatusBadge.module.css
  RepoAvatar/RepoAvatar.module.css

src/renderer/src/dev/
  SidecarTestPanel/SidecarTestPanel.module.css
```

这比之前两个全局 CSS 文件清楚很多。现在看到一个样式文件，基本就能知道它属于哪个组件、哪个视图、哪个布局区域。

---

## 十四、我的一点总结

这次重构让我更明确地感受到一件事：前端结构不能只拆 TSX，不拆 CSS。

如果组件已经拆成了 `layout`、`views`、`components`，但样式还集中在全局文件里，那么结构其实只完成了一半。因为用户看到的是界面，界面由组件和样式共同组成。组件所有权清楚，样式所有权不清楚，后续维护还是会绕回全局搜索。

所以这次整理的核心不是“把 CSS 文件变多”，而是让样式也拥有和组件一样的边界。

以后再新增样式时，规则会更明确：

```text
应用基础变量 -> assets/styles/tokens.css
全局 reset -> assets/styles/reset.css
全局 Ant 覆盖 -> assets/styles/antd.css
布局样式 -> 对应 layout 的 .module.css
视图样式 -> 对应 view 的 .module.css
共享组件样式 -> 对应 component 的 .module.css
开发测试面板样式 -> dev 目录自己的 .module.css
```

这样项目继续往后长时，不会再轻易回到“所有样式都塞进一个大文件”的状态。

对 IntelliGit 来说，这一步也算是把前面几轮前端结构重构补完整了：组件拆分、store 拆分、订阅边界、样式边界，现在终于能相互对齐了。
