export const COMMIT_SYSTEM_PROMPT = `你是一位专业的 Git 提交助手。你的职责是分析代码变更，将变更按语义意图分组，并生成符合 Conventional Commits 规范的提交信息。

## 提交类型
- feat: 新功能
- fix: 缺陷修复
- refactor: 代码重构（非功能变更，非缺陷修复）
- style: 代码格式调整（不影响逻辑）
- docs: 文档变更
- test: 测试相关
- chore: 构建、依赖、工具等辅助变更
- perf: 性能优化
- build: 构建系统或外部依赖变更
- ci: CI 配置变更

## 输出要求
始终以 JSON 格式输出，不添加额外解释。`

export const COMMIT_ANALYZE_PROMPT = `请分析以下代码变更，返回 JSON 格式的意图分组。

要求：
- 只输出 JSON，不要 Markdown 代码块，不要解释。
- groups 最多 5 组。
- type 只能使用 feat/fix/refactor/style/docs/test/chore/perf/build/ci。
- scope 使用英文小写短词，只允许字母、数字和连字符，例如 commit/settings/git/diff/renderer。
- summary 使用中文短句，描述“为什么值得单独提交”，不要超过 30 个中文字符。
- files 必须来自 diff 中出现的文件路径，不要编造不存在的文件。
- 每个文件只放入一个最合适的分组。
- 如果多个文件属于同一提交意图，应合并到同一组。

\`\`\`diff
{{diff}}
\`\`\`

返回格式：
{
  "groups": [
    {
      "type": "feat|fix|refactor|style|docs|test|chore|perf|build|ci",
      "scope": "可选的作用域",
      "summary": "一行描述（中文）",
      "files": ["受影响的文件路径列表"]
    }
  ]
}`

export const COMMIT_MESSAGE_PROMPT = `请根据以下暂存区变更生成一条 Conventional Commits 格式的提交信息。

要求：
- 只输出 JSON，不要 Markdown 代码块，不要解释。
- type 只能使用 feat/fix/refactor/style/docs/test/chore/perf/build/ci。
- scope 优先根据路径或模块推断，例如 commit/settings/git/diff/renderer；必须是英文小写短词，只允许字母、数字和连字符。
- subject 使用中文动宾短句，描述本次提交的核心价值，不要超过 50 个中文字符。
- subject 不要以句号、感叹号结尾。
- body 可留空；除非有必要说明原因，否则不要输出长 body。
- breaking 默认为 false。
- 如果 diff 主要是修复运行错误、黑屏、异常或失败流程，优先使用 fix。
- 如果 diff 主要是新增用户可见能力，优先使用 feat。
- 如果 diff 主要是结构调整但行为不变，优先使用 refactor。

\`\`\`diff
{{diff}}
\`\`\`

{{context}}

返回格式：
{
  "type": "feat|fix|refactor|style|docs|test|chore|perf|build|ci",
  "scope": "可选作用域（留空则不输出）",
  "subject": "简短描述（中文，命令语气，不超过 50 字符）",
  "body": "可选的详细说明（中文，可多行）",
  "breaking": false
}`

export function renderCommitAnalyzePrompt(diff: string): string {
  return COMMIT_ANALYZE_PROMPT.replace('{{diff}}', diff)
}

export function renderCommitMessagePrompt(diff: string, context?: string): string {
  return COMMIT_MESSAGE_PROMPT.replace('{{diff}}', diff).replace(
    '{{context}}',
    context ? `额外上下文：\n${context}` : ''
  )
}

// ─── 降级模板 ─────────────────────────────────────────────────────────────────

export interface CommitMessageResult {
  type: string
  scope?: string
  subject: string
  body?: string
  breaking: boolean
}

export function buildCommitMessage(result: CommitMessageResult): string {
  const scope = result.scope ? `(${result.scope})` : ''
  const breaking = result.breaking ? '!' : ''
  let msg = `${result.type}${scope}${breaking}: ${result.subject}`
  if (result.body) msg += `\n\n${result.body}`
  return msg
}
