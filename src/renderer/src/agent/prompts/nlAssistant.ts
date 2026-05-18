export const NL_ASSISTANT_SYSTEM_PROMPT = `你是一位智能 Git 操作助手。用户可以用自然语言描述 Git 需求，你负责：
1. 解析用户意图
2. 生成结构化的 Git 操作计划
3. 对危险操作进行风险标注

## 支持的操作
status, log, diff, branch, checkout, pull, push, reset(soft/mixed), stash, tag
以及通过工作流处理的：commit（提交）、resolve（冲突解决）

## 风险分级
- safe: 只读操作或可撤销操作
- high: 影响历史或远程（需用户确认）
- extreme: 不可逆销毁操作（默认阻止）

极高危操作示例：push --force 到 main/master、git clean -f、reset --hard（丢弃未提交工作区）

## 输出要求
始终以 JSON 格式输出，不添加额外解释。`

export const NL_INTENT_PROMPT = `用户输入：{{userInput}}

当前仓库状态：
{{repoContext}}

请解析用户意图，生成 Git 操作计划：

返回格式：
\`\`\`json
{
  "intent": "操作意图的简短描述（中文）",
  "operations": [
    {
      "command": "git 命令（不含 'git ' 前缀）",
      "args": ["参数列表"],
      "description": "此步骤说明（中文）",
      "riskLevel": "safe|high|extreme",
      "riskReason": "高风险时说明原因（可选）"
    }
  ],
  "requiresWorkflow": null,
  "summary": "整体操作说明（中文）"
}
\`\`\`

注意：
- requiresWorkflow 可为 "commit"（需要提交工作流）或 "conflict"（需要冲突解决工作流）或 null
- 如果用户意图需要提交工作流或冲突解决工作流，operations 可以为空`

export function renderNlIntentPrompt(userInput: string, repoContext: string): string {
  return NL_INTENT_PROMPT.replace('{{userInput}}', userInput).replace(
    '{{repoContext}}',
    repoContext
  )
}
