import type { LlmConfig, NlCommandPlan, NlOperation } from '../../../shared/types'
import { runAgent } from '../agent'
import { NL_ASSISTANT_SYSTEM_PROMPT, renderNlIntentPrompt } from '../agent/prompts/nlAssistant'
import { parseStructured, NL_INTENT_SCHEMA } from '../agent/outputParser'

export async function parseNlCommand(
  userInput: string,
  repoPath: string,
  currentBranch: string,
  config: LlmConfig
): Promise<NlCommandPlan | null> {
  const repoContext = `仓库路径：${repoPath}\n当前分支：${currentBranch || '未知'}`
  const userMessage = renderNlIntentPrompt(userInput, repoContext)

  const result = await runAgent<NlCommandPlan>(
    config,
    {
      taskType: 'nl_assistant',
      systemPrompt: NL_ASSISTANT_SYSTEM_PROMPT,
      userMessage
    },
    (raw) => parseStructured<NlCommandPlan>(raw, NL_INTENT_SCHEMA)
  )

  if (!result.success || !result.data) return null
  return result.data
}

export interface NlExecutionResult {
  command: string
  success: boolean
  output: string
}

export async function executeNlOperation(
  repoPath: string,
  op: NlOperation
): Promise<NlExecutionResult> {
  const args = [op.command, ...(op.args ?? [])].filter(Boolean)
  const commandStr = `git ${args.join(' ')}`

  if (op.riskLevel === 'extreme') {
    return { command: commandStr, success: false, output: '极高危操作已被阻止，请在终端手动执行' }
  }

  const response = await window.electronAPI.executeGitCommand({ repoPath, args })

  if (response.success) {
    return { command: commandStr, success: true, output: response.stdout || '执行成功' }
  }
  return {
    command: commandStr,
    success: false,
    output: response.error || response.stderr || '执行失败'
  }
}
