export const CONFLICT_SYSTEM_PROMPT = `你是一位专业的 Git 合并冲突分析助手。你的职责是：
1. 分析代码冲突的语义风险
2. 解读 ancestor/ours/theirs 三方内容
3. 生成合理的冲突解决建议

## 风险分级
- low: 简单冲突，双方变更独立，合并策略明确
- medium: 存在逻辑交叉，需要仔细审查
- high: 语义冲突明显，合并可能引入缺陷

## 输出要求
始终以 JSON 格式输出，不添加额外解释。`

export const CONFLICT_RISK_PROMPT = `请分析以下分支差异，识别潜在的语义冲突风险：

当前分支：{{currentBranch}}
目标分支：{{targetBranch}}

分支差异：
\`\`\`diff
{{branchDiff}}
\`\`\`

返回格式：
\`\`\`json
{
  "risks": [
    {
      "level": "low|medium|high",
      "type": "冲突类型（如：调用-删除冲突 / 并行修改 / 签名变更 / 接口不一致）",
      "description": "风险说明（中文）",
      "files": ["涉及文件"],
      "symbols": ["涉及符号（函数名、类名等）"]
    }
  ],
  "summary": "整体风险评估（中文）"
}
\`\`\``

export const CONFLICT_RESOLVE_PROMPT = `请分析以下冲突内容，给出合并建议：

文件：{{filePath}}

Ancestor（共同祖先）：
\`\`\`
{{ancestor}}
\`\`\`

Ours（当前分支）：
\`\`\`
{{ours}}
\`\`\`

Theirs（合入分支）：
\`\`\`
{{theirs}}
\`\`\`

返回格式：
\`\`\`json
{
  "strategy": "take_ours|take_theirs|merge_both|manual",
  "explanation": "为什么选择此策略（中文）",
  "resolvedContent": "合并后的完整内容（strategy 为 merge_both 时必填）",
  "warnings": ["需要特别注意的事项（可选）"]
}
\`\`\``

export function renderConflictRiskPrompt(
  currentBranch: string,
  targetBranch: string,
  branchDiff: string
): string {
  return CONFLICT_RISK_PROMPT.replace('{{currentBranch}}', currentBranch)
    .replace('{{targetBranch}}', targetBranch)
    .replace('{{branchDiff}}', branchDiff)
}

export function renderConflictResolvePrompt(
  filePath: string,
  ancestor: string,
  ours: string,
  theirs: string
): string {
  return CONFLICT_RESOLVE_PROMPT.replace('{{filePath}}', filePath)
    .replace('{{ancestor}}', ancestor)
    .replace('{{ours}}', ours)
    .replace('{{theirs}}', theirs)
}
