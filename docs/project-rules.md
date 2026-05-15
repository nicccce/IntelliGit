# IntelliGit 项目规则

> **元规则**：绝不把历史整改记录当成当前唯一真实结构；改动前必须核对现有源码树。

本文档提供给后续 AI 使用。目标是快速判断代码应该放在哪里、哪些边界必须保持、改完后必须跑什么检查。

本规则仅覆盖 Electron + React 前端架构。Sidecar Go 代码的规范见 `sidecar/README.md`。

## 1. 项目定位

- IntelliGit 是桌面 Git 客户端：Electron Main/Preload + React/TypeScript Renderer + Zustand + Go Sidecar。
- 绝不把组件、状态、IPC、样式、业务流程重新塞回一个大文件。
- 绝不绕过现有 `api`、`services`、`viewModels`、`store` 分层直接堆逻辑。

## 2. 总体结构

```text
src/shared/types/              # Git 领域类型、Git command map、Sidecar response 类型
src/main/                      # Electron main process、IPC handlers、Sidecar 管理
src/preload/                   # Renderer 可访问的安全桥接 API
src/renderer/src/app/          # 应用装配、Provider、主题、生命周期 hook、视图配置
src/renderer/src/layout/       # AppShell、导航、仓库面板、工具栏、通知栏、状态栏
src/renderer/src/views/        # ChangesView、HistoryView、SettingsView 等页面级业务视图
src/renderer/src/components/   # DiffView、FileStatusBadge、RepoAvatar 等可复用 UI
src/renderer/src/viewModels/   # UI 订阅适配层；组件只消费这里
src/renderer/src/store/        # Zustand 状态域
src/renderer/src/store/selectors/ # 命名 selector
src/renderer/src/services/     # 跨 store / 跨 API 的业务流程编排
src/renderer/src/api/          # window.electronAPI 的类型化封装
src/renderer/src/hooks/        # 跨视图的通用 React Hook（非 viewModel）
src/renderer/src/utils/        # 不依赖 React/Zustand 的纯函数
src/renderer/src/assets/styles/ # 全局 reset、tokens、Ant Design 覆盖
src/renderer/src/dev/          # SidecarTestPanel 等开发/测试入口（仅调试用）
scripts/                       # 构建脚本和边界检查脚本
docs/                          # 需求、整改记录、项目规则、博客和说明文档
```

## 3. Renderer 目录落点

- 应用级装配放 `app/`，跨视图骨架放 `layout/`，页面业务场景放 `views/`。
- 可复用、低业务耦合 UI 放 `components/`，纯格式化/映射/计算函数放 `utils/`。
- UI 需要的组合数据和 action 暴露放 `viewModels/`。
- 不依赖特定 view/store 的通用 React Hook 放 `hooks/`；依赖 store selector 的组合 Hook 放 `viewModels/`。
- 绝不让 `MainApp.tsx` 承担页面细节、Git 操作、Diff 渲染或复杂交互。
- 绝不在 `components/` 中实现完整业务流程。

## 4. 状态与订阅边界

- 必须按领域拆分 Zustand store，通过 `store/index.ts` 统一导出，在 `store/selectors/` 写命名 selector。
- 必须让 `views/`、`layout/`、`components/`、`dev/` 只通过 viewModel 消费 store 数据；viewModel 必须通过命名 selector 订阅 store。
- 绝不在 `views/`、`layout/`、`components/`、`dev/` 中直接 import store；viewModel 层允许且应该 import store。
- 绝不写 `useXxxStore()` 形式的完整订阅（store/service 中使用 `useXxxStore.getState()` 命令式访问不受此限）。
- 绝不在组件内写 inline selector，例如 `useGitStatusStore((state) => state.fileStatuses)`。
- 绝不恢复或新建 `useAppStore.ts` 这种全局大 store。
- `useGitStore` 仅服务 `dev/SidecarTestPanel` 调试场景，正式业务流程禁用。

## 5. Service 与 Workflow 边界

- 必须把跨 store、跨 API 的流程放在 `services/`，文件按业务域命名。当前已有的 service 列表见 `services/README.md`。
- 必须让 store 只保存状态所有权和局部 mutation。
- 绝不在 store action 里编排多个 store、API、UI message 和刷新流程。
- 绝不让组件直接调用多个 store 来拼完整业务流程。

## 6. API、IPC 与 Git 命令

- 必须把 Git 领域类型放在 `shared/types/git.ts`，Git 命令名/payload/result 类型放在 `shared/types/gitCommands.ts`。
- 必须通过 `api/gitClient.ts` 调用正式 Git IPC。
- 必须保持 `SidecarResponse<TData>` 泛型化，避免无约束 `unknown` 向业务层扩散。
- 必须新增 Git 能力时同步更新 shared type、API 客户端、service workflow 和 UI model。
- 绝不在正式 UI、viewModel、store、service 中直接调用 `window.electronAPI.invokeGit(...)`。
- 绝不用大量 `as` 类型断言掩盖 Git command map 缺失。
- 绝不让 Renderer 直接知道 Sidecar 通信细节。

## 7. 样式边界

- `main.tsx` 只引入 `antd/dist/reset.css` 和 `./assets/styles/index.css`。
- 全局 reset、主题 token、Ant Design 全局覆盖放 `assets/styles/`。
- layout/view/component/dev 的样式写在同目录 `.module.css`。
- 推荐使用 `utils/classNames.ts` 或等效工具（如 `clsx`）组合 CSS Module 状态 class，不要手动拼接字符串。
- 用局部 `:global(...)` 限定组件内部 Ant Design 覆盖范围。
- 绝不恢复 `assets/main.css` 或 `assets/features.css`。
- 绝不让 UI 模块直接 import `assets` 下的全局 CSS。
- 绝不把 `.ig-*` class 当做组件的内部样式边界。全局 `.ig-*` 仅限主题/布局级标记，且必须在 `assets/styles/` 中定义。

## 8. 页面与组件拆分

- 必须把局部交互状态留在对应面板，Diff 渲染放共享 `components/DiffView/`。
- 绝不把多个页面的状态重新集中到一个大 JSX 文件。
- 绝不让共享组件反向依赖具体页面。
- 各 view 的内部面板拆分方式见对应 view 目录的 `README.md`。

## 9. Main、Preload 与 Sidecar

- `src/main/` 管理 Electron 主进程、IPC handlers、Sidecar 生命周期。
- `src/preload/` 暴露 Renderer 需要的最小安全 API。
- Sidecar 管理收敛在 `src/main/core/SidecarManager.ts` 等 main/core 文件。
- 绝不在 Renderer 中 spawn 进程或访问 Node 私有能力。
- 绝不让 Preload 暴露不必要的通用 Node API。

## 10. 文档规则

- 新增重要目录时补 `README.md` 说明职责和边界。
- 完成结构性改动后更新相关 docs。

## 11. 验证命令

改动 Renderer 结构、store、service、viewModel、样式时：

```bash
npm.cmd run typecheck
npm.cmd run lint
```

改动生产构建、Sidecar、Main/Preload 或跨进程协议时：

```bash
npm.cmd run build
```

改动 Go sidecar 代码时：

```bash
cd sidecar && go test ./...
```

- 必须优先运行和改动范围匹配的最小检查。
- 必须在最终说明中写明已运行的检查和结果。
- 绝不在边界检查失败时绕过 `scripts/check-renderer-boundaries.mjs` 或 `scripts/check-renderer-styles.mjs`。

## 12. 最小改动原则

- 必须先读目标目录 README、相关 viewModel、service、store、selector，再改代码。
- 必须按现有命名、目录和导出方式扩展。
- 绝不顺手重构未被请求的模块。
- 绝不删除或回滚用户已有改动。
