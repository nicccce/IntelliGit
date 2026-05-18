# GlobalSettingsPanel

全局设置侧边面板，基于 SidePanelShell 骨架组件构建，用于管理跨仓库的全局配置。

## 结构

- 使用 `<SidePanelShell title="全局设置">` 作为外层容器，自动提供 Header、ResizeHandle 和拉伸状态同步
- 内部占位 UI：Git 身份信息配置、认证凭据管理（功能待实现）

## 设计定位

与 SettingsView（仓库级别设置/配置视图）不同，GlobalSettingsPanel 作为侧边面板存在，配置内容会应用于所有仓库。

## 关联状态

- `sidePanelWidth`：来自 `uiStore`（与仓库面板、对话面板共享同一拉伸宽度）