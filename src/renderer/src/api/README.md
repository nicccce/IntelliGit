# api

Renderer 侧的系统边界层，负责把 `window.electronAPI` 包成更小、更明确的客户端。

这里不保存 React 状态，也不编排业务流程；业务状态属于 `store/`，跨 store 的流程属于 `services/`。
