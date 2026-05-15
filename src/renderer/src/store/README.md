# store

Renderer 状态层，按状态所有权拆分 Zustand store。

组件不直接订阅 store 内部字段，而是通过：

```text
store/selectors/
viewModels/
```

形成稳定订阅契约。`selectors/` 只包含纯读取函数；`viewModels/` 负责把多个 selector、派生数据和 UI 需要的动作组合成页面模型。

## 边界

| 文件                 | 职责                                                     |
| -------------------- | -------------------------------------------------------- |
| `repositoryStore.ts` | 仓库列表、当前仓库、配置加载状态和局部写入入口           |
| `gitStatusStore.ts`  | 工作区文件状态、分支列表、当前分支、ahead/behind         |
| `diffStore.ts`       | 当前选中文件、工作区 diff 相关局部状态                   |
| `historyStore.ts`    | commit history、commit graph、选中 commit 和 commit diff |
| `uiStore.ts`         | 当前视图、全局 loading、错误和成功消息                   |
| `operationStore.ts`  | 用户操作的并发 loading 状态                              |
| `useGitStore.ts`     | 测试面板使用的原始命令历史，不参与正式界面业务状态       |

## 约定

- 组件只订阅自己需要的 store 字段。
- `views/`、`layout/`、`components/`、`dev/` 不直接 import store；统一通过 `viewModels/`。
- store hook 禁止完整订阅，也不要在组件里写 inline selector；selector 统一放在 `store/selectors/`。
- 直接 IPC 调用放在 `api/`，不要在 store 里直接使用 `window.electronAPI`。
- 跨 store 的业务流程放在 `services/`，例如 commit 后刷新状态和历史。
- `store/` 内部不互相调用其他 store；需要跨状态域协作时放到 service。

## 边界检查

```text
npm run check:renderer-boundaries
```

该脚本会检查 UI 文件直接 import store、完整订阅 store hook、组件内 inline selector 等回退问题。
