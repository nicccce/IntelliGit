# IntelliGit 问题 4 整改记录：前端 CSS 分层与样式边界重构

本文记录 `walkthrough-2026-5-15.md` 中问题 4 的整改设计和实际落地结果。

整改状态：

```text
已完成
```

完成日期：

```text
2026-05-16
```

原文中的问题 4 是：

```text
CSS 已经分层混乱
```

当时主要问题集中在：

```text
src/renderer/src/assets/main.css
src/renderer/src/assets/features.css
src/renderer/src/main.tsx
```

这两个全局 CSS 文件同时在 `main.tsx` 中引入，且都包含正式界面 `.ig-*` 样式。`features.css` 因为后加载，实际承担了覆盖 `main.css` 的职责。样式能工作，但依赖隐式加载顺序，后续维护成本很高。

本次整改目标不是简单拆文件，而是把样式所有权移动到组件、布局和视图目录中，让前端结构真正和前几轮 React 目录拆分对齐。

---

## 0. 完成内容总览

本次实际完成的重构范围：

```text
新增全局 styles 入口
抽出 reset / tokens / Ant Design 全局覆盖
删除 main.css / features.css 两个旧全局样式桶
把 dev 测试面板迁移到 CSS Module
把 layout 骨架层迁移到 CSS Modules
把 ChangesView / HistoryView / SettingsView 迁移到 CSS Modules
把 DiffView / FileStatusBadge / RepoAvatar 迁移到 CSS Modules
新增 classNames 工具
新增 renderer 样式边界检查脚本
把样式边界检查接入 npm run lint
```

整改后的核心边界：

```text
src/renderer/src/assets/styles/
  -> 只保存全局基础层

layout/
views/
components/
dev/
  -> 只 import 自己目录内的 .module.css

main.tsx
  -> 只 import antd reset 和 assets/styles/index.css
```

---

## 1. 删除旧的全局 CSS 桶

已删除文件：

```text
src/renderer/src/assets/main.css
src/renderer/src/assets/features.css
```

这两个文件原本一共超过 3000 行，混合了：

```text
全局 reset
主题 token
Sidecar 测试面板样式
正式应用骨架样式
ChangesView 样式
HistoryView 样式
SettingsView 样式
组件样式
Ant Design 覆盖
已不用的旧首页 / 旧侧栏样式
```

整改后不再保留 `legacy.css` 或其他过渡全局文件，避免旧问题换一个文件名继续存在。

---

## 2. 新增全局 styles 入口

新增目录：

```text
src/renderer/src/assets/styles/
```

当前文件：

```text
index.css
reset.css
tokens.css
antd.css
```

`main.tsx` 现在只引入：

```tsx
import 'antd/dist/reset.css'
import './assets/styles/index.css'
```

`index.css` 的职责是组合全局基础层：

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

@import './reset.css' layer(reset);
@import './tokens.css' layer(tokens);
@import './antd.css' layer(antd);
```

这里不再引入业务视图、布局或组件样式。

---

## 3. 抽出 reset / tokens / Ant Design 覆盖

`reset.css` 负责：

```text
box-sizing
html / body / #root 高度
body 基础字体、背景、抗锯齿
表单控件继承字体
```

`tokens.css` 负责：

```text
暗色主题 token
亮色主题 token
间距
圆角
字体
动效曲线
diff 颜色
```

`antd.css` 当前只保留必要的 Ant 根容器高度：

```css
.ig-ant-root,
.ig-ant-root .ant-app {
  height: 100%;
}
```

后续如果需要全局 Ant 覆盖，只能继续放在这里；组件内部的 Ant 覆盖则应放在对应 `.module.css` 中，并使用 `:global(...)` 限定范围。

---

## 4. 迁移 dev 测试面板样式

涉及文件：

```text
src/renderer/src/dev/SidecarTestPanel/index.tsx
src/renderer/src/dev/SidecarTestPanel/SidecarTestPanel.module.css
```

原来的测试面板使用大量全局 class：

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

这些 class 曾经放在 `main.css` 中，和正式界面样式混在一起。整改后，测试面板完全使用自己的 CSS Module，不再污染正式应用样式命名空间。

---

## 5. 迁移 layout 骨架层样式

已迁移：

```text
src/renderer/src/layout/AppShell/AppShell.module.css
src/renderer/src/layout/Toolbar/Toolbar.module.css
src/renderer/src/layout/ActivityRail/ActivityRail.module.css
src/renderer/src/layout/RepoPanel/RepoPanel.module.css
src/renderer/src/layout/StatusBar/StatusBar.module.css
src/renderer/src/layout/NotificationBar/NotificationBar.module.css
```

对应组件已经改为 import 本地 CSS Module：

```text
AppShell/index.tsx
Toolbar/index.tsx
ActivityRail/index.tsx
RepoPanel/index.tsx
StatusBar/index.tsx
NotificationBar/index.tsx
```

其中 `RepoPanel` 迁移量最大，包含：

```text
仓库面板展开 / 收起
面板拖拽调整宽度
仓库列表项
删除按钮 hover 状态
创建 / 添加 / 克隆仓库 Modal 表单
路径检查 Alert 样式
窄屏面板定位
```

这些样式现在都属于 `RepoPanel.module.css`，不再依赖全局 `.ig-*`。

---

## 6. 迁移 ChangesView 样式

已迁移：

```text
src/renderer/src/views/ChangesView/ChangesView.module.css
src/renderer/src/views/ChangesView/FileSection.module.css
src/renderer/src/views/ChangesView/CommitPanel.module.css
src/renderer/src/views/ChangesView/DiffPane.module.css
```

对应组件：

```text
ChangesView/index.tsx
FileSection.tsx
CommitPanel.tsx
DiffPane.tsx
```

整改后：

```text
ChangesView 负责三栏布局
FileSection 负责文件列表和选中态
CommitPanel 负责提交面板
DiffPane 负责 diff 外壳标题栏
```

共享的 diff 内容渲染不放在 `ChangesView` 内，而是继续归属于共享组件 `DiffView`。

---

## 7. 迁移 HistoryView 样式

已迁移：

```text
src/renderer/src/views/HistoryView/HistoryView.module.css
src/renderer/src/views/HistoryView/BranchPanel.module.css
src/renderer/src/views/HistoryView/CommitGraph.module.css
src/renderer/src/views/HistoryView/CommitDetail.module.css
```

对应组件：

```text
HistoryView/index.tsx
BranchPanel.tsx
CommitGraph.tsx
CommitDetail.tsx
```

整改后：

```text
HistoryView 负责三栏布局
BranchPanel 负责分支列表
CommitGraph 负责提交图列表
CommitDetail 负责 commit 详情和 reset 确认区
```

原本散在全局 CSS 中的 `.ig-graph-row.selected`、`.ig-branch-item.current`、`.ig-reset-confirm` 等状态样式，现在都收进了对应模块。

---

## 8. 迁移 SettingsView 样式

已迁移：

```text
src/renderer/src/views/SettingsView/SettingsView.module.css
src/renderer/src/views/SettingsView/index.tsx
```

迁移内容：

```text
设置页整体宽度和内边距
设置分区
仓库信息卡片
表单组
提示文本
远程仓库配置区域
Segmented 样式限定
Input / Password 局部覆盖
```

`SettingsView` 里的表单样式不再复用全局 `.ig-form-group`，避免和 `RepoPanel` Modal 中的表单互相影响。

---

## 9. 迁移共享组件样式

已迁移：

```text
src/renderer/src/components/DiffView/DiffView.module.css
src/renderer/src/components/FileStatusBadge/FileStatusBadge.module.css
src/renderer/src/components/RepoAvatar/RepoAvatar.module.css
```

对应组件：

```text
DiffView/index.tsx
FileStatusBadge/index.tsx
RepoAvatar/index.tsx
```

其中 `DiffView` 包含：

```text
空状态
diff 滚动区域
binary 文件提示
hunk header
added / removed 行样式
行号和内容列
```

`FileStatusBadge` 和 `RepoAvatar` 也不再依赖全局 `.ig-file-status-badge`、`.ig-repo-initials`。

---

## 10. 新增 classNames 工具

新增文件：

```text
src/renderer/src/utils/classNames.ts
```

内容很小，只负责组合 CSS Module class：

```ts
export function classNames(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ')
}
```

用途：

```text
active / selected / current / added / removed 等状态 class 组合
减少组件里手写模板字符串
避免继续拼接全局 class name
```

---

## 11. 新增样式边界检查脚本

新增文件：

```text
scripts/check-renderer-styles.mjs
```

该脚本检查：

```text
main.tsx 只能引入 antd reset 和 assets/styles/index.css
禁止恢复 src/renderer/src/assets/main.css
禁止恢复 src/renderer/src/assets/features.css
禁止 UI 模块直接 import assets 下的全局 CSS
components / layout / views / dev 只能 import 本地 .module.css
```

已接入 `package.json`：

```json
"lint": "eslint --cache . && npm run check:renderer-boundaries && npm run check:renderer-styles",
"check:renderer-styles": "node scripts/check-renderer-styles.mjs"
```

这样后续如果有人重新引入旧全局 CSS，`npm run lint` 会直接失败。

---

## 12. 当前样式结构

整改后的样式结构大致如下：

```text
src/renderer/src/assets/styles/
  index.css
  reset.css
  tokens.css
  antd.css

src/renderer/src/app/
  MainApp.module.css

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
  ChangesView/CommitPanel.module.css
  ChangesView/DiffPane.module.css
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

---

## 13. 验证结果

已执行：

```text
npm.cmd run check:renderer-styles
npm.cmd run check:renderer-boundaries
npm.cmd run typecheck
npm.cmd run build
git diff --check
npm.cmd run lint
```

结果：

```text
全部通过
```

补充说明：

```text
npm.cmd run lint 仍输出 64 个既有 prettier warning
这些 warning 集中在未改动的 main / sidecar 相关文件
本次 CSS 重构没有新增 lint error
```

构建结果中，renderer CSS 产物从整改前约：

```text
92 KB
```

下降到整改后约：

```text
43 KB
```

这说明旧的全局 CSS 桶已经不再被打包进 renderer。

---

## 14. 整改后的收益

本次整改后，问题 4 的主要风险已经被消除：

```text
不再有 main.css / features.css 加载顺序竞争
测试面板样式不再污染正式应用
正式应用样式跟随组件目录
视图样式和共享组件样式边界更清楚
Ant Design 覆盖有明确归属
新增 lint 护栏防止样式结构回退
删除了大量已不用旧样式
```

对后续开发的影响：

```text
新增 layout 样式 -> 放在对应 layout 子目录的 .module.css
新增 view 样式 -> 放在对应 view 子目录的 .module.css
新增 component 样式 -> 放在对应 component 子目录的 .module.css
新增全局 token -> 放在 assets/styles/tokens.css
新增全局 Ant 覆盖 -> 放在 assets/styles/antd.css
不要恢复 assets/main.css 或 assets/features.css
```

---

## 15. 后续建议

虽然问题 4 的结构整改已经完成，但还建议继续做两类检查。

第一，人工视觉走查：

```text
ChangesView
HistoryView
SettingsView
RepoPanel
SidecarTestPanel
暗色 / 亮色主题切换
空状态
加载状态
Modal / Alert / Dropdown
```

CSS Module 迁移已经通过构建验证，但视觉细节仍适合人工逐屏确认。

第二，后续可以继续收敛主题 token：

```text
appTheme.ts
assets/styles/tokens.css
```

当前 Ant Design token 和 CSS token 已经语义接近，但仍是两个文件维护。后续如果要继续提高一致性，可以考虑抽出更统一的主题配置来源。
