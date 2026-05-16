# IntelliGit 问题 5 整改记录：App 入口与 Sidecar 测试面板边界重构

本文记录 `walkthrough-2026-5-15.md` 中问题 5 的整改设计和实际落地结果。

整改状态：

```text
已完成
```

完成日期：

```text
2026-05-16
```

原文中的问题 5 指向旧的 `App.tsx`：正式主界面和 Sidecar 测试面板混在同一个组件里，并且在提前 `return <MainApp />` 之后继续调用 hooks，触发 React hooks 规则错误。

当前整改不只修复 lint，而是把正式应用入口、开发测试入口、正式 store、调试 store 四条边界彻底分开。

---

## 0. 完成内容总览

本次实际完成的重构范围：

```text
收紧 App.tsx 入口分流
删除根目录 MainApp.tsx 转发文件
把正式主界面入口固定到 app/MainApp.tsx
把 Electron mode 类型收紧为 main / test
把 Sidecar 测试面板的 store / selector / view model 移入 dev 目录
从正式 store / viewModels 导出面移除测试面板状态
新增 dev 目录说明
补强 renderer 边界检查脚本
更新 app / store / project-rules 文档
```

整改后的核心边界：

```text
src/renderer/src/App.tsx
  -> 只根据 electronAPI.mode 选择正式入口或测试入口

src/renderer/src/app/MainApp.tsx
  -> 正式主界面装配入口

src/renderer/src/dev/SidecarTestPanel/
  -> Sidecar 原始通信测试面板
  -> 内聚自己的 raw client / store / selector / view model

src/renderer/src/store/
  -> 只保存正式业务状态

src/renderer/src/viewModels/
  -> 只导出正式 UI 的 view model
```

---

## 1. App.tsx 入口分流收紧

涉及文件：

```text
src/renderer/src/App.tsx
src/renderer/src/app/MainApp.tsx
src/renderer/src/MainApp.tsx
```

完成内容：

```text
App.tsx 直接 import ./app/MainApp
App.tsx 继续作为唯一 mode 分流入口
删除 src/renderer/src/MainApp.tsx 根目录转发文件
```

整改后：

```tsx
import MainApp from './app/MainApp'
import SidecarTestPanel from './dev/SidecarTestPanel'

function App(): React.JSX.Element {
  return window.electronAPI.mode === 'test' ? <SidecarTestPanel /> : <MainApp />
}
```

这样做以后，`MainApp` 的真实落点只有一个：

```text
src/renderer/src/app/MainApp.tsx
```

根目录不再保留同名转发文件，避免后续继续围绕旧路径扩展代码。

---

## 2. Electron mode 类型收紧

涉及文件：

```text
src/shared/types/sidecar.ts
src/preload/index.ts
```

完成内容：

```text
新增 ElectronMode = 'main' | 'test'
ElectronAPI.mode 从可选 string 改为必填 ElectronMode
preload 中把 process.env.ELECTRON_MODE 归一化为 main / test
```

整改后的类型边界：

```ts
export type ElectronMode = 'main' | 'test'

export interface ElectronAPI {
  mode: ElectronMode
}
```

归一化逻辑：

```ts
function resolveElectronMode(mode: string | undefined): ElectronMode {
  return mode === 'test' ? 'test' : 'main'
}
```

这样 Renderer 不再消费任意字符串，也不需要处理 `mode` 缺失场景。

---

## 3. Sidecar 测试面板状态移入 dev

旧结构中，Sidecar 测试面板使用的调试 store 位于正式 store 层：

```text
src/renderer/src/store/useGitStore.ts
src/renderer/src/store/selectors/gitCommandSelectors.ts
src/renderer/src/viewModels/useSidecarTestPanelModel.ts
```

问题是：

```text
调试状态从正式 store/index.ts 导出
调试 view model 从正式 viewModels/index.ts 导出
store 内直接调用 window.electronAPI.invokeGit
正式业务状态和开发测试工具边界不够硬
```

本次删除了上述正式层文件，并新增：

```text
src/renderer/src/dev/SidecarTestPanel/sidecarTestClient.ts
src/renderer/src/dev/SidecarTestPanel/sidecarCommandStore.ts
src/renderer/src/dev/SidecarTestPanel/sidecarCommandSelectors.ts
src/renderer/src/dev/SidecarTestPanel/useSidecarTestPanelModel.ts
```

新的职责划分：

```text
sidecarTestClient.ts
  -> 只服务测试面板的 raw invokeGit 调用

sidecarCommandStore.ts
  -> 测试面板自己的命令执行状态和历史记录

sidecarCommandSelectors.ts
  -> 测试面板自己的 selector

useSidecarTestPanelModel.ts
  -> 测试面板自己的 view model
```

`SidecarTestPanel/index.tsx` 现在只从同目录消费自己的 view model：

```tsx
import { useSidecarTestPanelModel } from './useSidecarTestPanelModel'
```

---

## 4. 正式导出面清理

涉及文件：

```text
src/renderer/src/store/index.ts
src/renderer/src/store/selectors/index.ts
src/renderer/src/viewModels/index.ts
```

完成内容：

```text
store/index.ts 移除 useGitStore / CommandRecord 导出
store/selectors/index.ts 移除 gitCommandSelectors 导出
viewModels/index.ts 移除 useSidecarTestPanelModel 导出
```

整改后，正式业务层已经无法通过常规 barrel export 使用测试面板状态。

---

## 5. Renderer 边界检查补强

涉及文件：

```text
scripts/check-renderer-boundaries.mjs
```

新增检查：

```text
禁止恢复 src/renderer/src/MainApp.tsx 根目录转发文件
除 App.tsx 外，正式 renderer 文件禁止 import dev-only 模块
raw window.electronAPI.invokeGit 只能出现在：
  src/renderer/src/api/gitClient.ts
  src/renderer/src/dev/SidecarTestPanel/sidecarTestClient.ts
```

这可以防止后续出现三类回退：

```text
重新创建根 MainApp.tsx
正式代码反向依赖 dev 调试工具
绕过 api/gitClient.ts 直接调用 raw invokeGit
```

---

## 6. 文档同步

新增文档：

```text
src/renderer/src/dev/README.md
```

更新文档：

```text
src/renderer/src/app/README.md
src/renderer/src/store/README.md
docs/project-rules.md
```

文档中明确：

```text
App.tsx 是唯一可以根据 mode 选择 dev 测试入口的文件
正式主界面真实入口是 app/MainApp.tsx
不要恢复根目录 MainApp.tsx 转发文件
dev 调试入口可以拥有自己的局部测试 store
dev 调试 store 不得进入正式 store / viewModels / api 导出面
```

---

## 7. 验证结果

已运行：

```bash
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
```

结果：

```text
lint 通过
typecheck 通过
build 通过
```

说明：

```text
lint 当前仍有 63 个 Prettier warning
这些 warning 位于既有 main / build 脚本相关文件中
本次问题 5 整改未新增 lint error
renderer boundary check passed
renderer style boundary check passed
```

---

## 8. 最终结构

问题 5 整改后的入口结构：

```text
src/renderer/src/App.tsx
  -> app/MainApp
  -> dev/SidecarTestPanel

src/renderer/src/app/
  -> MainApp.tsx
  -> AppProviders.tsx
  -> useThemeMode.ts
  -> useAutoRefresh.ts

src/renderer/src/dev/
  -> README.md
  -> SidecarTestPanel/
       index.tsx
       SidecarTestPanel.module.css
       sidecarTestClient.ts
       sidecarCommandStore.ts
       sidecarCommandSelectors.ts
       useSidecarTestPanelModel.ts
```

正式状态层中已经移除：

```text
src/renderer/src/store/useGitStore.ts
src/renderer/src/store/selectors/gitCommandSelectors.ts
src/renderer/src/viewModels/useSidecarTestPanelModel.ts
src/renderer/src/MainApp.tsx
```

---

## 9. 后续建议

问题 5 本身已经完成。后续如果继续清理，可以单独处理当前 lint 中剩余的 Prettier warning，主要集中在：

```text
scripts/build-sidecar.mjs
src/main/core/SidecarManager.ts
src/main/index.ts
src/main/ipc/configHandlers.ts
src/main/ipc/gitHandlers.ts
```

这部分属于格式整理，不影响问题 5 的结构边界结论。
