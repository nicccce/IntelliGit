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

## 输出要求
始终以 JSON 格式输出，不添加额外解释。`

export const COMMIT_ANALYZE_PROMPT = `请分析以下代码变更，返回 JSON 格式的意图分组：

\`\`\`diff
{{diff}}
\`\`\`

返回格式：
\`\`\`json
{
  "groups": [
    {
      "type": "feat|fix|refactor|style|docs|test|chore|perf",
      "scope": "可选的作用域",
      "summary": "一行描述（中文）",
      "files": ["受影响的文件路径列表"]
    }
  ]
}
\`\`\``

export const COMMIT_MESSAGE_PROMPT = `请根据以下暂存区变更生成一条 Conventional Commits 格式的提交信息：

\`\`\`diff
{{diff}}
\`\`\`

{{context}}

返回格式：
\`\`\`json
{
  "type": "feat|fix|refactor|style|docs|test|chore|perf",
  "scope": "可选作用域（留空则不输出）",
  "subject": "简短描述（中文，命令语气，不超过 50 字符）",
  "body": "可选的详细说明（中文，可多行）",
  "breaking": false
}
\`\`\``

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
