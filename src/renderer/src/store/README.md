# store

Renderer 状态层，按状态所有权拆分 Zustand store。

## 边界

| 文件 | 职责 |
| --- | --- |
| `repositoryStore.ts` | 仓库列表、当前仓库、配置加载状态和仓库配置操作 |
| `gitStatusStore.ts` | 工作区文件状态、分支列表、当前分支、ahead/behind |
| `diffStore.ts` | 当前选中文件、工作区 diff、hunk 暂存相关局部状态 |
| `historyStore.ts` | commit history、commit graph、选中 commit 和 commit diff |
| `uiStore.ts` | 当前视图、全局 loading、错误和成功消息 |
| `operationStore.ts` | 用户操作的并发 loading 状态 |
| `useGitStore.ts` | 测试面板使用的原始命令历史，不参与正式界面业务状态 |

## 约定

- 组件只订阅自己需要的 store 字段。
- 直接 IPC 调用放在 `api/`，不要在 store 里直接使用 `window.electronAPI`。
- 跨 store 的业务流程放在 `services/`，例如 commit 后刷新状态和历史。
