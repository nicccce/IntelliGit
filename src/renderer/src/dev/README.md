# dev

开发和调试入口目录。这里的模块可以拥有局部测试状态和 raw protocol client，但只能服务调试 UI，不得被正式 `app/`、`layout/`、`views/`、`components/`、`store/`、`services/` 或 `api/` 消费。

## 约定

- `App.tsx` 是唯一可以导入 `dev/` 入口的正式文件，用于根据运行模式切换测试面板。
- 调试面板需要的 Zustand store、selector、view model 和 raw client 放在对应面板目录内部。
- 正式 Git 调用仍然只能走 `api/gitClient.ts`，不要把 dev raw client 复用到业务流程。
