# ChatPanel

AI 对话侧边面板，基于 SidePanelShell 骨架组件构建。

## 结构

- 使用 `<SidePanelShell title="智能对话">` 作为外层容器，自动提供 Header、ResizeHandle 和拉伸状态同步
- 内部目前为占位 UI，等待 AI 对话功能上线

## 状态

当前为预留入口，UI 骨架已完成，对话逻辑待后续接入。

## 关联状态

- `sidePanelWidth`：来自 `uiStore`（与仓库面板、设置面板共享同一拉伸宽度）