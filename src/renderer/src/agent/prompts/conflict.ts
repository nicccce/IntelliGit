export const CONFLICT_SYSTEM_PROMPT = `你是一位专业的 Git 合并冲突分析助手。你的职责是：
1. 分析代码冲突的语义风险
2. 解读 ancestor/ours/theirs 三方内容
3. 生成合理的冲突解决建议
4. 为冲突编辑器输出可直接落地的合并策略

## 工作阶段
- prompt: 优先基于 AST、符号与上下文给出结构化结论
- fallback: 当上下文不完整、内容无法解析或模型输出异常时，退回到保守的规则化建议

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

上下文：
{{context}}

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

export const CONFLICT_FALLBACK_PROMPT = `当以下输入不完整、无法解析或模型输出不符合 JSON 要求时，请退回到保守策略并输出最小可执行结论：

文件：{{filePath}}

可用信息：
{{context}}

请只输出 JSON，格式如下：
\`\`\`json
{
  "strategy": "manual|take_ours|take_theirs",
  "explanation": "为什么无法使用精细分析或为什么选择保守策略（中文）",
  "warnings": ["缺失信息、解析失败或需要人工确认的原因"]
}
\`\`\`

规则：
- 无法确认语义时，优先 manual。
- 若明显为单侧新增且另一侧为空，可选择 take_ours 或 take_theirs。
- 不要编造未提供的代码内容。`

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
  theirs: string,
  context: string = ''
): string {
  return CONFLICT_RESOLVE_PROMPT.replace('{{filePath}}', filePath)
    .replace('{{context}}', context)
    .replace('{{ancestor}}', ancestor)
    .replace('{{ours}}', ours)
    .replace('{{theirs}}', theirs)
}

export function renderConflictFallbackPrompt(filePath: string, context: string): string {
  return CONFLICT_FALLBACK_PROMPT.replace('{{filePath}}', filePath).replace('{{context}}', context)
}
