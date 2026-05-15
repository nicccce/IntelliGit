# 语义拆分与中间结果 Patch 设计

## 1. 背景

IntelliGit 当前已经具备基础的暂存和提交能力：

- 文件级暂存：`staging.add` / `staging.addAll`
- patch 级暂存：`staging.applyPatch`
- patch 级取消暂存：`staging.unstageHunk`
- 提交：`commit.create`

现有 `staging.applyPatch` 的能力是：前端传入一段 unified diff patch，Sidecar 执行：

```bash
git apply --cached --unidiff-zero -
```

它只修改 Git index，也就是暂存区，不直接修改工作区文件。

这为 hunk 级暂存提供了底层能力，但还不足以完成更高阶的“语义拆分提交”。语义拆分提交要解决的问题是：用户的最终工作区可能已经混合了多个意图，系统需要把这些变化拆成多个有语义边界的 commit。

简单场景中，不同语义正好落在不同 hunk 上，可以直接按 hunk 分组暂存。但复杂场景中，不同语义可能修改同一行、同一函数、同一连续区域，无法通过“选择 hunk 子集”完成拆分。此时需要引入“中间结果 patch”。

## 2. 目标

本设计目标是支持如下工作流：

```text
base 状态
  -> semantic step 1 的中间状态
  -> semantic step 2 的中间状态
  -> ...
  -> final 工作区状态
```

系统按这些中间状态生成多个 commit。每个 commit 对应一个语义意图。

典型例子：

```text
base:  空
final: aaabbbccc
```

用户或 AI 希望拆成两个提交：

```text
commit 1: 空 -> aaaaaaaaa
commit 2: aaaaaaaaa -> aaabbbccc
```

这里 `aaaaaaaaa` 并不是当前工作区的直接子集，而是一个中间版本。系统需要能临时把这个中间版本写入 index，提交后再把 index 写成最终版本，生成第二个 commit。

## 3. 非目标

第一版不追求完全自动化提交，不让 AI 直接修改 Git index 或执行 commit。

第一版不解决任意复杂重构的完美语义证明。系统只保证：

- AI 给出候选拆分方案。
- 程序验证 patch 链的可应用性。
- 用户确认后才真正写入暂存区和创建提交。
- 最终工作区内容不被意外改写。

## 4. 核心原则

### 4.1 AI 负责语义，程序负责 Git

AI 的职责：

- 识别变更意图。
- 给 hunk 或文件内容切分建议。
- 生成中间状态候选。
- 给出每一步 commit message 建议。

程序的职责：

- 获取 base / index / worktree 内容。
- 解析 diff 和 hunk。
- 生成或校验 patch。
- 写入 index。
- 执行 commit。
- 在失败时恢复 index。

AI 不应直接输出要执行的 Git 命令，也不应直接决定提交。

### 4.2 最终状态必须守恒

任何语义拆分方案都必须满足：

```text
apply(stepN, ...apply(step2, apply(step1, base))) == final
```

如果最终结果和当前工作区 final 不一致，该方案不能自动执行。

### 4.3 工作区默认不被修改

中间结果应优先写入 Git index，不直接改用户工作区文件。

用户当前看到的工作区保持 final 状态。例如：

```text
工作区: aaabbbccc
index:  aaaaaaaaa
```

这种状态是合法的。commit 1 提交 index 中的 `aaaaaaaaa`，提交后工作区仍保留 `aaabbbccc`，因此可以继续生成 commit 2。

## 5. 场景分类

### 5.1 非重叠 hunk 拆分

不同语义落在不同 hunk 上：

```text
hunk A -> fix: 修复 token 过期判断
hunk B -> refactor: 清理认证工具函数
```

此时 AI 只需要返回 hunk 分组：

```json
{
  "groups": [
    {
      "id": "g1",
      "title": "fix: 修复 token 过期判断",
      "hunkIds": ["h1", "h3"]
    },
    {
      "id": "g2",
      "title": "refactor: 清理认证工具函数",
      "hunkIds": ["h2"]
    }
  ]
}
```

程序根据 `hunkIds` 拼接 patch，并调用 `staging.applyPatch`。

### 5.2 重叠区域拆分

不同语义修改同一行、同一函数或同一段连续文本，无法通过 hunk 子集拆分。

例子：

```text
base:  空
final: aaabbbccc
```

期望拆成：

```text
step 1: 空 -> aaaaaaaaa
step 2: aaaaaaaaa -> aaabbbccc
```

此时 AI 不能只返回 hunk ID，而要返回中间状态：

```json
{
  "steps": [
    {
      "id": "s1",
      "title": "feat: 初始化占位内容",
      "files": [
        {
          "path": "demo.txt",
          "baseKind": "base",
          "content": "aaaaaaaaa"
        }
      ]
    },
    {
      "id": "s2",
      "title": "feat: 补充 b/c 语义段",
      "files": [
        {
          "path": "demo.txt",
          "baseKind": "previous",
          "content": "aaabbbccc"
        }
      ]
    }
  ]
}
```

程序把这些内容转换为：

```text
base -> s1 content
s1 content -> s2 content
```

然后逐步写入 index 并提交。

## 6. 数据模型

### 6.1 Hunk 输入模型

建议后端返回标准 hunk，而不是只返回当前的 `ChunkInfo`。

```ts
interface SemanticHunk {
  id: string
  filePath: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  patch: string
  changeText: string
  addedLines: number
  deletedLines: number
}
```

其中 `patch` 必须是可单独应用到 index 的 unified diff：

```diff
diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,3 +10,4 @@
 const a = 1
+const b = 2
 return a
```

### 6.2 语义计划模型

```ts
interface SemanticCommitPlan {
  baseHead: string
  worktreeFingerprint: string
  steps: SemanticCommitStep[]
}

interface SemanticCommitStep {
  id: string
  title: string
  body?: string
  mode: 'hunkSelection' | 'intermediateContent'
  hunkIds?: string[]
  files?: SemanticIntermediateFile[]
}

interface SemanticIntermediateFile {
  path: string
  content: string
  baseKind: 'base' | 'previous'
}
```

### 6.3 执行结果模型

```ts
interface SemanticApplyResult {
  success: boolean
  createdCommits: string[]
  failedStepId?: string
  error?: string
}
```

## 7. 推荐新增后端能力

### 7.1 `diff.hunks`

返回 Git 标准 hunk 列表。

输入：

```json
{
  "path": "src/foo.ts",
  "staged": false,
  "unified": 3
}
```

输出：

```json
{
  "hunks": [
    {
      "id": "h1",
      "filePath": "src/foo.ts",
      "oldStart": 10,
      "oldLines": 3,
      "newStart": 10,
      "newLines": 4,
      "patch": "diff --git ..."
    }
  ]
}
```

实现建议：优先复用 `git diff --unified=<n>` 原始输出并解析 hunk，而不是继续使用当前 LCS `ChunkInfo` 作为暂存依据。

### 7.2 `staging.applyPatchCheck`

只校验 patch 是否能写入 index，不真正修改 index。

底层命令：

```bash
git apply --cached --check --unidiff-zero -
```

输入：

```json
{
  "patch": "diff --git ..."
}
```

输出：

```json
{
  "ok": true
}
```

### 7.3 `staging.writeFileToIndex`

把指定文件内容写入 index，但不修改工作区。

输入：

```json
{
  "path": "demo.txt",
  "content": "aaaaaaaaa"
}
```

语义等价于：

```text
git hash-object -w --stdin
git update-index --add --cacheinfo <mode> <blobHash> <path>
```

或者使用 go-git Storer 直接写 blob 和 index entry。

这是支持“中间结果”的核心接口。

### 7.4 `staging.snapshotIndex`

保存当前 index 快照，用于失败恢复。

输出：

```json
{
  "snapshotId": "idx-20260510-001"
}
```

第一版可以简单复制 `.git/index` 到应用临时目录。

### 7.5 `staging.restoreIndex`

从快照恢复 index。

输入：

```json
{
  "snapshotId": "idx-20260510-001"
}
```

### 7.6 `semantic.executePlan`

可选高阶接口。它接收完整语义计划，在 Sidecar 内部一次性完成校验、写 index、commit、失败恢复。

第一版也可以不做这个高阶接口，而是在前端 orchestrate 每一步。但从安全性看，后端统一执行更容易保证事务边界。

## 8. 执行流程

### 8.1 生成计划

```text
1. 前端请求 diff.hunks
2. 前端把 hunks 摘要发送给 AI
3. AI 返回 SemanticCommitPlan
4. 前端展示计划给用户确认
```

发送给 AI 的内容建议包含：

- 文件路径
- hunk id
- hunk 变更内容
- 周围函数名或 AST 上下文
- 当前分支名
- 用户输入的拆分目标

避免发送：

- 认证信息
- 远程 token
- 与当前变更无关的大文件全文

### 8.2 执行非重叠 hunk step

```text
1. 根据 hunkIds 合并 patch
2. staging.applyPatchCheck
3. staging.applyPatch
4. commit.create
5. 继续下一 step
```

### 8.3 执行中间内容 step

```text
1. 根据 step.files 写 index
2. 校验 index 对应内容等于 step content
3. commit.create
4. 下一 step 以刚创建的 commit 作为 previous
```

最后一步完成后，应确保：

```text
HEAD == 语义计划最后一步
工作区内容 == 用户执行前的 final 工作区内容
index 可以选择恢复为空，或保持最后一步一致
```

如果最后一步已经提交了 final，则工作区应变为 clean。

## 9. 校验要求

### 9.1 执行前校验

执行计划前必须校验：

- 当前 HEAD 等于计划中的 `baseHead`。
- 当前工作区 fingerprint 等于计划中的 `worktreeFingerprint`。
- 没有未处理的 merge/rebase/cherry-pick 状态。
- 每个 patch 都能 `git apply --cached --check`。
- 中间内容转换链最终等于当前工作区 final。

### 9.2 执行中校验

每一步 commit 前校验：

- index 非空。
- index 内容符合当前 step 预期。
- commit message 非空。

每一步 commit 后校验：

- 新 commit 存在。
- 新 HEAD 等于该 commit。
- 工作区文件未被意外改写。

### 9.3 执行后校验

执行完成后校验：

- 创建的 commit 数量等于 step 数量。
- 最终 HEAD tree 等于执行前 final 工作区对应 tree。
- 如果设计为提交全部变更，则 `git status` 应 clean。

## 10. 回滚策略

### 10.1 计划执行前

创建 index 快照：

```text
snapshotIndex()
```

记录：

- 原始 HEAD
- 原始 index hash
- 原始工作区 fingerprint

### 10.2 patch 校验失败

不修改 index，直接返回错误。

### 10.3 index 写入失败

恢复 index 快照，不改 HEAD。

### 10.4 commit 部分成功后失败

这类情况最敏感。默认不自动 reset，因为自动移动 HEAD 可能破坏用户已有状态。

推荐第一版策略：

- 停止执行。
- 展示已创建 commit 列表。
- 提供“撤销本次语义提交”的显式按钮。
- 用户确认后再执行安全回滚。

可选的安全回滚方式：

```bash
git reset --soft <originalHead>
```

这会保留变更在 index/工作区，但会移动 HEAD。必须二次确认。

## 11. AI 输出约束

AI 输出必须是结构化 JSON，不输出 Git 命令。

AI 需要遵守：

- 每个 step 只能描述一个主要语义。
- 如果能用 hunkIds 表达，就使用 `hunkSelection`。
- 只有 hunk 重叠或同一区域多语义混合时，才使用 `intermediateContent`。
- `intermediateContent` 必须给完整文件内容，而不是局部片段。
- 每个 step 必须有 commit title。
- 不允许删除用户 final 中未提及的内容。

## 12. UI 设计建议

### 12.1 语义计划面板

展示：

- 计划包含几个 commit。
- 每个 commit 的标题。
- 影响文件。
- 变更摘要。
- 是否包含中间结果。

### 12.2 中间结果对比

对 `intermediateContent` step 展示三栏或两段切换：

```text
base -> intermediate
intermediate -> final
```

用户必须能看到 AI 生成的中间内容。

### 12.3 执行按钮

建议按钮：

- “暂存此语义组”
- “按计划生成多个提交”
- “重新生成拆分方案”
- “放弃计划”

有中间结果时，执行按钮需要额外确认：

```text
该计划会创建多个提交，并临时写入 Git 暂存区。工作区文件不会被直接改写。
```

## 13. 第一版落地方案

### 阶段一：非重叠 hunk 分组

实现：

- `diff.hunks`
- hunk parser
- AI 返回 hunkIds 分组
- UI 展示语义组
- 点击语义组调用 `staging.applyPatch`

暂不支持中间内容。

### 阶段二：中间内容预览

实现：

- AI 返回 `intermediateContent`
- 前端展示中间内容 diff
- 程序校验最终内容守恒
- 暂不自动 commit，只允许用户预览和导出计划

### 阶段三：写 index 与多 commit 执行

实现：

- `staging.writeFileToIndex`
- `staging.snapshotIndex`
- `staging.restoreIndex`
- `staging.applyPatchCheck`
- 多 step commit 执行

### 阶段四：自动恢复与审计

实现：

- 失败恢复向导
- 执行日志
- 操作审计记录
- 计划可重复执行检测

## 14. 当前代码差距

当前已有：

- `staging.applyPatch`
- `staging.unstageHunk`
- `diff.workdirRaw`
- `commit.create`
- 文件级 `add` / `remove`

当前缺少：

- Git 标准 hunk 解析结果。
- hunk patch 生成与合并。
- patch check 接口。
- 写中间文件内容到 index 的接口。
- index 快照和恢复。
- 多 step commit 的事务流程。
- UI 中的语义计划展示和确认。

因此，当前代码能支持简单的 patch 暂存，但还不能可靠支持完整的中间结果 patch 链。

## 15. 推荐结论

语义拆分 patch 可行，但应分层实现：

```text
Git diff/hunk 是事实来源
AI 负责语义分组和中间状态建议
程序负责 patch/index/commit
用户负责确认最终执行
```

对于非重叠变更，使用 hunk 分组即可。

对于重叠变更，必须引入中间状态，并通过 `writeFileToIndex` 这类接口把中间结果写入 index。只有这样才能在不改工作区 final 的前提下，生成连续、可审查、语义清晰的多个 commit。
