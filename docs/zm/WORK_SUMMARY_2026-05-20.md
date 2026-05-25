# IntelliGit 工作汇总 - 2026-05-20

本文档用于帮助其他 contributor 快速了解 2026-05-20 当天围绕“智能提交 / Commit Panel / Renderer 架构边界”完成的工作、关键设计和后续接入建议。

## 背景

今天主要围绕提交区的智能提交能力推进：

- 支持按变更意图进行文件级分组。
- 支持基于暂存区 diff 生成 Conventional Commits 提交信息。
- 收敛 `CommitPanel` 的 UI / 状态 / 业务逻辑边界。
- 建立 AI 未配置或 AI 调用失败时的本地 fallback 闭环，保证功能不因 LLM 配置缺失而中断。

相关提交：

- `5e4d32d feat(commit): 支持智能提交变更分组`
- `a8c80e2 refactor(renderer): 收敛提交面板架构边界`
- `17ab72c refactor(commit): 完善智能提交降级闭环`

## 已完成内容

### 1. 智能提交变更分组

新增了智能分组入口，用于读取当前变更 diff，并按提交意图对文件进行分组。

当前分组粒度为文件级：

- 输入：当前工作区 diff / 暂存区 diff。
- 输出：`CommitIntentGroup[]`。
- 每组包含：
  - `type`
  - `scope?`
  - `summary`
  - `files`

当前第一版暂未做到 hunk / AST 级别的逻辑块分组，后续可在底层 diff/hunk 能力完善后升级。

### 2. 智能提交信息生成

提交面板支持基于暂存区 diff 生成 Conventional Commits 风格提交信息。

流程要点：

1. 用户点击生成提交信息。
2. 如果暂存区为空，服务层会尝试暂存全部变更。
3. 读取 staged diff。
4. 调用智能提交 provider 生成提交信息。
5. 将结果回填到提交输入框。

### 3. 按分组暂存并生成提交信息

分组生成后，用户可以选择某个分组并执行“暂存选中分组”。

当前行为：

1. 根据分组中的 `files` 逐个执行暂存。
2. 读取暂存区 diff。
3. 将分组上下文和 diff 一起传入提交信息生成流程。
4. 将生成结果回填到提交输入框。

这样可以支持将一个工作区中的多类变更拆成多次提交。

### 4. `CommitPanel` 架构边界收敛

对提交面板进行了边界整理：

- `CommitPanel.tsx` 主要负责 UI 状态、按钮事件和展示。
- `commitPanelModel.ts` 负责提交动作和 UI store 的成功/失败提示封装。
- `smartCommitService.ts` 负责智能提交业务流程编排。
- `smartCommitProvider.ts` 负责 AI / fallback provider 能力封装。
- `CommitPanel.module.css` 只承载提交面板局部样式。

目标是避免 UI 组件直接堆积 Git 调用、AI 调用和复杂流程判断。

### 5. 新增 `SmartCommitProvider` 抽象

新增文件：

- `src/renderer/src/services/smartCommitProvider.ts`

该 provider 抽象出两个核心能力：

- `analyzeChanges(input)`：分析变更并输出提交意图分组。
- `generateMessage(input)`：根据 diff 和可选分组上下文生成提交信息。

当前默认实现为 `LlmSmartCommitProvider`。

设计目标：

- 业务服务层不直接感知 LLM 是否配置。
- UI 不直接关心真实 AI 调用和降级逻辑。
- 后续可以替换 provider，例如 mock provider、本地模型 provider、规则引擎 provider。

### 6. AI 未配置 / 调用失败时的 fallback 闭环

智能提交能力现在不会因为 AI 未配置而直接失败。

当前 fallback 策略：

- 智能分组 fallback：将所有变更文件归为一个 `chore` 分组。
- 提交信息 fallback：生成基础模板提交信息，例如 `chore: 更新 N 个文件`。

fallback 触发场景：

- 没有配置 LLM。
- LLM 配置缺少 API Key。
- LLM 调用失败。
- LLM 返回结构解析失败。

UI 会展示降级提示，例如：

- `AI 服务未配置，已使用本地模板降级`
- `AI 服务调用失败，已使用本地模板降级`

这保证了智能提交流程的最小闭环：

1. 点击智能分组。
2. 得到可选分组。
3. 选择分组。
4. 暂存分组文件。
5. 生成提交信息。
6. 执行提交。

## 关键文件说明

### `src/renderer/src/views/ChangesView/CommitPanel.tsx`

提交面板 UI 组件。

主要职责：

- 管理提交输入框内容。
- 管理智能提交按钮 loading 状态。
- 展示智能分组列表。
- 展示 AI fallback 降级提示。
- 调用 service/model 层完成具体动作。

### `src/renderer/src/views/ChangesView/CommitPanel.module.css`

提交面板局部样式。

新增了：

- `.ig-smart-notice`

用于展示 AI 未配置或调用失败时的本地模板降级说明。

### `src/renderer/src/views/ChangesView/commitPanelModel.ts`

提交面板 model 层。

主要职责：

- 封装提交动作。
- 调用 `refreshRepository`。
- 调用 `uiStore` 展示成功/错误提示。

### `src/renderer/src/services/smartCommitService.ts`

智能提交业务编排层。

主要职责：

- 获取 workdir/staged diff。
- 获取当前变更文件列表。
- 自动暂存全部变更以生成提交信息。
- 按分组暂存文件。
- 读取分组暂存后的 staged diff。
- 调用 `smartCommitProvider`。
- 将 provider 结果转成 UI 可用数据。

### `src/renderer/src/services/smartCommitProvider.ts`

智能提交 provider 层。

主要职责：

- 统一封装 AI 和 fallback。
- 控制传给 LLM 的 diff 上下文长度。
- 渲染 prompt。
- 解析结构化输出。
- 格式化 Conventional Commit 消息。
- 在 AI 不可用时返回本地 fallback。

## 当前验证情况

已执行：

```bash
npm run lint
```

结果：

- 命令退出码为 `0`。
- Renderer boundary check passed。
- Renderer style boundary check passed。
- 仍存在大量既有 CRLF / Prettier warning，但没有 error。

已执行：

```bash
npm run typecheck
```

结果：

- 命令退出码为 `0`。
- Node typecheck passed。
- Web typecheck passed。

## 已知限制

### 1. 分组粒度仍为文件级

当前智能分组以文件为单位。

如果一个文件中包含多个提交意图，目前不能拆成多个 hunk 级提交。

后续可以结合：

- diff hunk 解析。
- AST 变更分析。
- 局部暂存能力。

升级到逻辑块级分组。

### 2. fallback 提交信息较基础

本地 fallback 当前主要保证流程可用，不追求语义准确。

例如：

- `chore: 更新 3 个文件`

后续可以根据文件路径和状态增强规则，例如：

- `feat(renderer): 更新提交面板`
- `fix(git): 修复暂存状态同步`
- `style(ui): 调整提交区样式`

### 3. LLM 配置链路仍需真实环境验证

当前 provider 会读取 `getCurrentLlmConfig()`。

下一步建议确认：

- 设置页保存的 provider/model/apiKey 是否正确写入 store。
- 应用启动后配置是否正确恢复。
- `checkLlmConnection()` 状态是否能反映真实连接情况。
- 真实 AI 输出是否稳定满足结构化 schema。

## 后续建议

### P1：完善真实 LLM 接入验证

建议下一位 contributor 优先验证：

1. 在设置页配置真实 LLM。
2. 执行连接测试。
3. 在 ChangesView 中制造多文件变更。
4. 点击智能分组。
5. 检查是否返回合理分组。
6. 选择分组并生成提交信息。
7. 检查提交信息是否符合 Conventional Commits。

### P2：增强 fallback 规则

可以在 `smartCommitProvider` 或单独的规则模块中增强本地模板能力：

- 根据路径推断 scope。
- 根据文件状态推断 type。
- 根据文件数量和目录生成更有意义的 subject。

### P3：引入 hunk 级分组

当底层 Git/diff 能力支持后，可以将 `CommitIntentGroup.files` 扩展为更细粒度结构，例如：

```ts
interface CommitIntentGroup {
  type: string
  scope?: string
  summary: string
  files: string[]
  hunks?: Array<{
    file: string
    hunkId: string
    summary: string
  }>
}
```

然后在 UI 层支持选择逻辑块，而不仅仅是文件。

### P4：补充单元测试 / mock provider

建议后续加入：

- `SmartCommitProvider` mock 实现。
- `smartCommitService` 的流程测试。
- AI 失败 / 未配置 / 正常返回的分支测试。

## 贡献者注意事项

1. Renderer 层不要直接调用 Node API。
2. Git 操作应通过已有 `invokeGit` / sidecar 通道完成。
3. UI 组件不要直接堆积业务流程，优先下沉到 service/model。
4. CSS 使用局部 module，避免全局样式泄漏。
5. 智能提交相关逻辑优先走 `smartCommitProvider`，不要在 UI 中直接调用 `runAgent`。
6. 变更后建议至少运行：

```bash
npm run lint
npm run typecheck
```

## 今日结论

今天已完成智能提交从 UI 到 service/provider 的基础架构闭环，并确保 AI 不可用时也能通过本地 fallback 完成最小可用流程。

这为后续接入真实 LLM、增强本地规则、升级 hunk 级智能提交奠定了较清晰的边界。