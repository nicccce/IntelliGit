# Components — 可复用 UI 组件

此目录存放可复用的 UI 组件。组件可以服务多个视图，但应尽量少知道业务流程；复杂业务状态优先留在 `views/` 或 `layout/`。

## 命名规范

- 每个组件为独立文件夹：`ComponentName/index.tsx`
- 需要局部样式时，再在组件目录内增加 `styles.css`
- 导出统一通过 barrel export（`index.ts`）

## 规划组件

| 组件           | 说明             |
| -------------- | ---------------- |
| `Button/`      | 通用按钮         |
| `Input/`       | 输入框           |
| `StatusBadge/` | Git 文件状态标签 |
| `DiffViewer/`  | Diff 差异展示    |
| `Terminal/`    | 命令输出面板     |

## 当前组件

| 组件               | 说明             |
| ------------------ | ---------------- |
| `DiffView/`        | 工作区 Diff 展示 |
| `FileStatusBadge/` | Git 文件状态徽标 |
| `RepoAvatar/`      | 仓库缩写头像     |
