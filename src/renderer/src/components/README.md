# Components — 基础 UI 组件

此目录存放可复用的基础 UI 组件，不包含业务逻辑。

## 命名规范

- 每个组件为独立文件夹：`ComponentName/index.tsx` + `ComponentName/styles.css`
- 导出统一通过 barrel export（`index.ts`）

## 规划组件

| 组件 | 说明 |
|---|---|
| `Button/` | 通用按钮 |
| `Input/` | 输入框 |
| `StatusBadge/` | Git 文件状态标签 |
| `DiffViewer/` | Diff 差异展示 |
| `Terminal/` | 命令输出面板 |
