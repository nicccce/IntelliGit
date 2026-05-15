# viewModels

Renderer UI 的订阅适配层。

此目录负责把 Zustand selector、派生数据和页面需要的动作组合成稳定的 view model。`views/`、`layout/`、`components/` 和 `dev/` 中的组件只消费这里的 hook，不直接 import store。

## 约定

- 每个 hook 对应一个布局、视图或复杂组件的状态需求。
- 派生数组和复杂计算优先在这里用 `useMemo` 包住。
- 业务流程动作从 `services/` 引入，不从 store action 暴露给组件。
- 新增 UI 时先补 selector，再补 view model，最后让组件消费 view model。
