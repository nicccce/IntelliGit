# IntelliGit 问题 3 整改记录：组件订阅 Store 的边界重构

本文记录 `walkthrough-2026-5-15.md` 中问题 3 的整改设计和实际落地结果。

整改状态：

```text
已完成
```

完成日期：

```text
2026-05-16
```

原文中的问题 3 指向旧的 `MainApp.tsx` 和 `useAppStore()`。在问题 1、问题 2 已整改后，当前代码已经不存在旧的 `useAppStore()`，但仍然存在更隐蔽的结构问题：

```text
组件直接 import store
组件内散落 selector
派生数据写在 JSX 组件里
部分 store action 编排了其他 store
缺少防止订阅方式回退的自动检查
```

本次整改将问题 3 升级为：建立稳定的 store 订阅契约，让 UI 组件不再直接知道 store 内部结构。

---

## 0. 完成内容总览

本次实际完成的重构范围：

```text
建立 selector 层
建立 viewModels 层
迁移 layout / views / components / dev 的 store 订阅
拆分 ChangesView
拆分 HistoryView
把 repository workflow 从 store 移到 service
把 diff hunk workflow 从 diffStore 移到 gitWorkflowService
移动 legacy Sidecar 测试面板
新增 renderer 边界检查脚本
补充 store / services / viewModels 说明文档
```

整改后的核心边界：

```text
components / layout / views / dev
  -> 只消费 viewModels

viewModels
  -> 订阅 store selectors
  -> 组合派生数据
  -> 暴露组件需要的页面模型

store/selectors
  -> 只保存纯 selector

store
  -> 只保存状态所有权和局部 mutation

services
  -> 编排跨 store / 跨 API 的业务流程
```

---

## 1. 新增 selector 层

新增目录：

```text
src/renderer/src/store/selectors/
```

该目录按状态域拆分 selector：

```text
repositorySelectors.ts
gitStatusSelectors.ts
diffSelectors.ts
historySelectors.ts
uiSelectors.ts
operationSelectors.ts
gitCommandSelectors.ts
```

组件和 view model 不再写：

```tsx
useGitStatusStore((state) => state.fileStatuses)
```

而是使用命名 selector：

```tsx
useGitStatusStore(selectFileStatuses)
```

这样 selector 的命名、复用和审查边界都更清楚。

---

## 2. 新增 viewModels 层

新增目录：

```text
src/renderer/src/viewModels/
```

职责：

```text
组合多个 store selector
集中处理 UI 需要的派生数据
暴露页面级 model
把 service action 提供给组件
```

当前已覆盖：

```text
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
```

整改后：

```text
views/
layout/
components/
dev/
```

不再直接 import `store`。

---

## 3. 派生数据下沉

从组件中移出的典型逻辑：

```text
staged / unstaged 文件拆分
changeCount 统计
branch picker 的本地/远程分支合并
operation loading label
commit graph lane map
Diff 文件选择状态
```

新增或扩展的工具：

```text
src/renderer/src/utils/fileStatus.ts
src/renderer/src/utils/branchOptions.ts
src/renderer/src/utils/commitGraph.ts
```

这样 JSX 组件主要负责渲染，不再夹杂状态推导规则。

---

## 4. 视图拆分

`ChangesView` 拆分为：

```text
ChangesView/index.tsx
ChangesView/FileSection.tsx
ChangesView/DiffPane.tsx
ChangesView/CommitPanel.tsx
```

`HistoryView` 拆分为：

```text
HistoryView/index.tsx
HistoryView/BranchPanel.tsx
HistoryView/CommitGraph.tsx
HistoryView/CommitDetail.tsx
```

收益：

```text
提交输入框状态不再牵动整个 ChangesView
分支搜索和 reset 确认状态留在各自面板内部
Commit Graph、Commit Detail、Branch Panel 的职责更清楚
后续增加 AI、沙箱、冲突解决时有更明确的插入点
```

---

## 5. Store / Service 解耦

`repositoryStore.ts` 不再承载仓库业务 workflow，只保留：

```text
repos
currentRepo
configLoaded
setRepositoryState()
```

新增：

```text
src/renderer/src/services/repositoryWorkflowService.ts
```

用于编排：

```text
loadConfig()
addRepo()
createRepo()
cloneRepo()
removeRepo()
switchRepo()
updateRepoSettings()
```

`diffStore.ts` 中的 hunk 暂存/取消暂存流程也移动到 `gitWorkflowService.ts`，避免 store 内部调用其他 store。

本次完成后，`repositoryStore.ts` 的职责明显收窄为状态容器，不再直接 import `repositoryService`、`refreshCoordinator` 或 `uiStore` 来做业务编排。

---

## 6. Legacy 测试面板处理

旧的 `App.tsx` 中仍有完整订阅：

```tsx
useGitStore()
```

整改后，测试面板移动到：

```text
src/renderer/src/dev/SidecarTestPanel/
```

并通过：

```text
useSidecarTestPanelModel()
gitCommandSelectors.ts
```

精确订阅所需字段。

`App.tsx` 只负责根据运行模式选择正式界面或测试面板。

---

## 7. 防回退检查

新增脚本：

```text
scripts/check-renderer-boundaries.mjs
```

新增 npm script：

```text
npm run check:renderer-boundaries
```

检查内容：

```text
UI 文件直接 import store
store hook 完整订阅
组件中 inline selector
```

同时 `npm run lint` 已串联该检查。

---

## 8. 文档同步

同步更新：

```text
src/renderer/src/store/README.md
src/renderer/src/services/README.md
src/renderer/src/viewModels/README.md
```

这些文档现在写明：

```text
UI 文件不直接 import store
store hook 禁止完整订阅
组件内不要写 inline selector
跨状态域流程进入 services
viewModels 是 UI 订阅适配层
```

---

## 9. 验证结果

已执行：

```text
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run check:renderer-boundaries
```

结果：

```text
typecheck 通过
lint 通过
renderer boundary check 通过
```

说明：

```text
lint 过程中仍会输出部分既有 prettier warning，集中在 src/main/* 和 scripts/build-sidecar.mjs。
这些 warning 不是本次问题 3 重构新增代码导致，且当前 lint 命令最终退出码为 0。
```

---

## 10. 本次新增文件

新增 selector：

```text
src/renderer/src/store/selectors/index.ts
src/renderer/src/store/selectors/repositorySelectors.ts
src/renderer/src/store/selectors/gitStatusSelectors.ts
src/renderer/src/store/selectors/diffSelectors.ts
src/renderer/src/store/selectors/historySelectors.ts
src/renderer/src/store/selectors/uiSelectors.ts
src/renderer/src/store/selectors/operationSelectors.ts
src/renderer/src/store/selectors/gitCommandSelectors.ts
```

新增 view model：

```text
src/renderer/src/viewModels/index.ts
src/renderer/src/viewModels/README.md
src/renderer/src/viewModels/useActivityRailModel.ts
src/renderer/src/viewModels/useNotificationModel.ts
src/renderer/src/viewModels/useStatusBarModel.ts
src/renderer/src/viewModels/useDiffViewModel.ts
src/renderer/src/viewModels/useRepoPanelModel.ts
src/renderer/src/viewModels/useToolbarModel.ts
src/renderer/src/viewModels/useChangesViewModel.ts
src/renderer/src/viewModels/useHistoryViewModel.ts
src/renderer/src/viewModels/useSettingsViewModel.ts
src/renderer/src/viewModels/useSidecarTestPanelModel.ts
```

新增视图内组件：

```text
src/renderer/src/views/ChangesView/FileSection.tsx
src/renderer/src/views/ChangesView/DiffPane.tsx
src/renderer/src/views/ChangesView/CommitPanel.tsx
src/renderer/src/views/HistoryView/BranchPanel.tsx
src/renderer/src/views/HistoryView/CommitGraph.tsx
src/renderer/src/views/HistoryView/CommitDetail.tsx
```

新增服务和工具：

```text
src/renderer/src/services/repositoryWorkflowService.ts
src/renderer/src/utils/branchOptions.ts
src/renderer/src/utils/commitGraph.ts
```

新增 dev 面板和检查脚本：

```text
src/renderer/src/dev/SidecarTestPanel/index.tsx
scripts/check-renderer-boundaries.mjs
```

---

## 11. 本次修改的关键旧文件

关键入口和布局：

```text
src/renderer/src/App.tsx
src/renderer/src/app/MainApp.tsx
src/renderer/src/layout/ActivityRail/index.tsx
src/renderer/src/layout/NotificationBar/index.tsx
src/renderer/src/layout/RepoPanel/index.tsx
src/renderer/src/layout/StatusBar/index.tsx
src/renderer/src/layout/Toolbar/index.tsx
```

关键视图：

```text
src/renderer/src/views/ChangesView/index.tsx
src/renderer/src/views/HistoryView/index.tsx
src/renderer/src/views/SettingsView/index.tsx
src/renderer/src/components/DiffView/index.tsx
```

关键状态和服务：

```text
src/renderer/src/store/repositoryStore.ts
src/renderer/src/store/diffStore.ts
src/renderer/src/store/gitStatusStore.ts
src/renderer/src/store/historyStore.ts
src/renderer/src/store/uiStore.ts
src/renderer/src/store/operationStore.ts
src/renderer/src/store/useGitStore.ts
src/renderer/src/services/gitWorkflowService.ts
src/renderer/src/utils/fileStatus.ts
package.json
```

---

## 12. 当前验收口径

已满足：

```text
views / layout / components / dev 不直接 import store
不存在 useXxxStore() 形式的完整订阅
不存在组件内 inline selector
repositoryStore 不再承载 repository workflow
diffStore 不再承载 hunk workflow
ChangesView 和 HistoryView 已按面板拆分
legacy Sidecar 测试面板已移出 App.tsx
新增边界检查脚本并接入 lint
```

需要后续另行处理：

```text
src/main/* 和 scripts/build-sidecar.mjs 中已有 prettier warning
问题 4 的 CSS 分层混乱尚未整改
```
