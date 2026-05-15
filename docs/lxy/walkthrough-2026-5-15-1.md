# IntelliGit 项目结构整改记录：问题 1

本文件记录 `walkthrough-2026-5-15.md` 中“问题 1：前端主界面单文件过长、职责过多”的实际整改结果。

本次整改目标不是改变前端功能，而是先把 `MainApp.tsx` 中已经混在一起的应用装配、布局组件、业务视图和通用组件拆开，让后续继续处理 store、CSS、IPC 类型等问题时有更清楚的落点。

---

## 1. 已完成内容

### 1.1 收窄 MainApp.tsx

原文件：

```text
src/renderer/src/MainApp.tsx
```

整改前承担了以下职责：

```text
主题配置
应用 Provider
自动刷新
仓库侧栏
顶部工具栏
变更视图
Diff 展示
历史视图
设置页
通知栏
状态栏
大量交互逻辑
```

整改后，`src/renderer/src/MainApp.tsx` 只作为兼容入口：

```ts
export { default } from './app/MainApp'
```

真正的主界面装配移动到：

```text
src/renderer/src/app/MainApp.tsx
```

该文件现在只负责：

```text
加载配置
读取当前视图和仓库
切换主题
控制仓库面板开关
启动自动刷新 hook
装配 AppShell
```

---

## 2. 新增前端结构

本次新增了下面几层目录。

```text
src/renderer/src/app/
src/renderer/src/layout/
src/renderer/src/views/
src/renderer/src/components/
src/renderer/src/utils/
```

### 2.1 app

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

职责：

```text
应用级装配
主题 token
Provider 包裹
全局生命周期 hook
视图枚举和导航配置
```

这里不放具体业务视图，也不实现仓库、Diff、历史等页面细节。

### 2.2 layout

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

职责：

```text
工作台外壳
跨视图布局
主导航
仓库面板
顶部工具栏
全局通知
底部状态栏
```

具体拆分：

```text
AppShell/
  -> 组合 Toolbar、ActivityRail、RepoPanel、内容区和 StatusBar

ActivityRail/
  -> 负责仓库入口、视图切换、主题切换

RepoPanel/
  -> 负责仓库列表、创建、添加、克隆、删除和路径校验

Toolbar/
  -> 负责当前仓库/分支展示、分支切换、Fetch/Pull/Push/刷新

NotificationBar/
  -> 负责展示全局错误和成功消息

StatusBar/
  -> 负责展示当前仓库路径、分支、ahead/behind 和操作状态
```

### 2.3 views

```text
src/renderer/src/views/
  ChangesView/
  HistoryView/
  SettingsView/
  README.md
```

职责：

```text
页面级业务视图
每个视图对应一个明确业务场景
```

具体拆分：

```text
ChangesView/
  -> 变更、暂存、Diff 和提交面板

HistoryView/
  -> 分支列表、Commit Graph、提交详情、checkout/reset

SettingsView/
  -> 仓库信息、提交身份、远程仓库和认证表单
```

### 2.4 components

```text
src/renderer/src/components/
  DiffView/
  FileStatusBadge/
  RepoAvatar/
  README.md
```

职责：

```text
可复用 UI 组件
尽量不承载完整业务流程
```

具体拆分：

```text
DiffView/
  -> 工作区 Diff 展示

FileStatusBadge/
  -> Git 文件状态码的颜色和文本展示

RepoAvatar/
  -> 根据仓库名称生成仓库缩写头像
```

### 2.5 utils

```text
src/renderer/src/utils/
  fileStatus.ts
  repoName.ts
  README.md
```

职责：

```text
不依赖 React / Zustand 的纯函数
小型映射和格式化逻辑
```

当前包含：

```text
fileStatus.ts
  -> statusColor / statusLabel

repoName.ts
  -> repoInitials
```

---

## 3. README 补充

按要求，新增的前端组件和视图文件夹都补了简短 README，用于说明这部分的职责和后续设计边界。

新增 README：

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

同时更新了：

```text
src/renderer/src/components/README.md
src/renderer/src/views/README.md
```

---

## 4. 本次刻意没有处理的内容

为了降低风险，本次只处理问题 1 的结构拆分，没有顺手混入其它问题。

未处理项：

```text
问题 2：拆分 useAppStore.ts
问题 4：拆分 main.css / features.css
问题 5：拆分 App.tsx 和 TestPanel，修复条件 hooks lint 错误
问题 6：建立强类型 Git command map
问题 10：重新设计自动刷新策略
问题 11：凭据迁出普通配置文件
```

本次也没有移动 CSS。现有样式仍由：

```text
src/renderer/src/assets/main.css
src/renderer/src/assets/features.css
```

全局引入。这样可以先确认组件结构拆分不改变界面行为，后续再单独处理样式归属。

---

## 5. 验证结果

执行完整类型检查：

```bash
npm.cmd run typecheck
```

结果：

```text
通过
```

对本次改动范围执行 ESLint：

```bash
npx.cmd eslint src/renderer/src/MainApp.tsx src/renderer/src/app src/renderer/src/layout src/renderer/src/views src/renderer/src/components/DiffView src/renderer/src/components/FileStatusBadge src/renderer/src/components/RepoAvatar src/renderer/src/utils
```

结果：

```text
通过
```

全仓库 lint：

```bash
npm.cmd run lint
```

结果：

```text
未通过
```

原因不是本次拆分引入的新错误，而是原来已经存在的 `src/renderer/src/App.tsx` 条件 hooks 问题，对应原清单中的问题 5。

---

## 6. 当前效果

问题 1 已完成第一轮结构性整改。

整改后：

```text
MainApp.tsx 不再是大文件
应用装配、布局、业务视图、通用组件、纯函数工具有了明确目录
components/ 和 views/ 不再只有 README 占位
每个新增前端组件目录都有简短职责说明
```

建议下一步优先处理：

```text
问题 5：拆 App.tsx / TestPanel，先消除全仓库 lint 的硬错误
```

处理完问题 5 后，再继续进入：

```text
问题 2：拆 useAppStore.ts
问题 4：拆 CSS
```
