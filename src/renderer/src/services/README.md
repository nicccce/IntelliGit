# services

业务流程层，负责组织多个 API 调用或多个 store 的协作。

约定：

- `api/` 只负责系统调用边界。
- `store/` 只保存状态和局部 action。
- `services/` 放跨状态域的流程，例如仓库切换后的刷新、远程认证 payload 组装、commit 后的级联刷新。

## 当前服务分层

| 文件                           | 职责                                                   |
| ------------------------------ | ------------------------------------------------------ |
| `repositoryService.ts`         | 仓库配置、创建、添加、克隆、切换、设置保存等纯业务过程 |
| `repositoryWorkflowService.ts` | 把仓库业务过程和 repository/ui/git 状态刷新编排起来    |
| `gitWorkflowService.ts`        | 暂存、提交、分支、远程、reset/checkout 等 Git 操作流程 |
| `refreshCoordinator.ts`        | 当前仓库下的本地/远程刷新和仓库作用域状态清理          |
| `remoteService.ts`             | 远程仓库类型推断、远程 URL 同步和认证 payload 构造     |
| `sidecarHealthService.ts`      | 调用 `sidecar.ping` 并写入 Sidecar 运行状态            |

`workflow` 服务可以通过 `getState()` 编排多个 store；普通 store 不反向调用其他 store。
