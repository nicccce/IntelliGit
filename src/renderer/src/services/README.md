# services

业务流程层，负责组织多个 API 调用或多个 store 的协作。

约定：

- `api/` 只负责系统调用边界。
- `store/` 只保存状态和局部 action。
- `services/` 放跨状态域的流程，例如仓库切换后的刷新、远程认证 payload 组装、commit 后的级联刷新。
