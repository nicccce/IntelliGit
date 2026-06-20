import type { LlmConfig, NlCommandPlan, NlOperation, ConversationMessage, SafetyPolicyConfig } from '../../../shared/types'
import { loadConfig } from '../api/configClient'
import { runAgent } from '../agent'
import { NL_ASSISTANT_SYSTEM_PROMPT, renderNlIntentPrompt } from '../agent/prompts/nlAssistant'
import { parseStructured, NL_INTENT_SCHEMA } from '../agent/outputParser'

export interface RepoContext {
  localBranches: string[]       // 不含 HEAD 的本地分支列表
  remoteBranches: string[]      // 远程追踪分支列表（如 origin/master）
  commitsAhead: number          // 当前分支领先远程的提交数
  commitsBehind: number         // 当前分支落后远程的提交数
  changedFiles: number          // 工作区+暂存区有变更的文件数
  stagedFiles: number           // 已暂存文件数
  recentCommits: Array<{ hash: string; message: string }> // 最近若干条提交
}

export async function parseNlCommand(
  userInput: string,
  repoPath: string,
  currentBranch: string,
  config: LlmConfig,
  history?: ConversationMessage[],
  ctx?: RepoContext
): Promise<NlCommandPlan | null> {
  const lines: string[] = [
    `仓库路径：${repoPath}`,
    `当前分支：${currentBranch || '未知'}${
      ctx ? `（领先远程 ${ctx.commitsAhead} 个提交，落后 ${ctx.commitsBehind} 个提交）` : ''
    }`
  ]

  if (ctx?.localBranches.length) {
    lines.push(
      '本地分支：\n' +
        ctx.localBranches
          .map((b) => `  ${b === currentBranch ? '* ' : '  '}${b}`)
          .join('\n')
    )
  }
  if (ctx?.remoteBranches.length) {
    lines.push('远程分支：\n' + ctx.remoteBranches.map((b) => `  ${b}`).join('\n'))
  }
  if (ctx) {
    lines.push(
      `工作区状态：${ctx.changedFiles} 个文件有变更（${ctx.stagedFiles} 个已暂存，${ctx.changedFiles - ctx.stagedFiles} 个未暂存）`
    )
  }
  if (ctx?.recentCommits.length) {
    lines.push(
      '最近提交：\n' +
        ctx.recentCommits.map((c) => `  ${c.hash.slice(0, 7)} ${c.message}`).join('\n')
    )
  }

  const repoContext = lines.join('\n')
  const userMessage = renderNlIntentPrompt(userInput, repoContext)

  const result = await runAgent<NlCommandPlan>(
    config,
    {
      taskType: 'nl_assistant',
      systemPrompt: NL_ASSISTANT_SYSTEM_PROMPT,
      userMessage,
      messages: history?.length ? history : undefined
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

const DEFAULT_SAFETY_POLICY: SafetyPolicyConfig = {
  allowForcePush: false,
  allowResetHard: false
}

function isForcePush(op: NlOperation): boolean {
  return op.command === 'push' && (op.args ?? []).some((arg) => arg === '--force' || arg === '-f' || arg.startsWith('--force-'))
}

function isResetHard(op: NlOperation): boolean {
  return op.command === 'reset' && (op.args ?? []).includes('--hard')
}

export function applyNlSafetyPolicy(plan: NlCommandPlan, policy: SafetyPolicyConfig): NlCommandPlan {
  return {
    ...plan,
    operations: plan.operations.map((op) => {
      if (op.riskLevel !== 'extreme') return op
      if ((isForcePush(op) && policy.allowForcePush) || (isResetHard(op) && policy.allowResetHard)) {
        return {
          ...op,
          riskLevel: 'high',
          riskReason: `${op.riskReason ?? '高风险操作'}（已在安全策略中解锁，仍需二次确认）`
        }
      }
      return op
    })
  }
}

export async function loadSafetyPolicy(): Promise<SafetyPolicyConfig> {
  const appConfig = await loadConfig()
  return { ...DEFAULT_SAFETY_POLICY, ...appConfig.safetyPolicy }
}

/** 将执行结果交给 LLM 解读，返回自然语言答复 */
export async function interpretGitOutput(
  originalQuestion: string,
  results: NlExecutionResult[],
  config: LlmConfig
): Promise<string | null> {
  const outputText = results
    .map((r) => `$ ${r.command}\n${r.success ? r.output : `错误：${r.output}`}`)
    .join('\n\n')

  const result = await runAgent<string>(
    config,
    {
      taskType: 'nl_interpretation',
      systemPrompt:
        '你是 IntelliGit 智能助手。根据 git 命令的执行结果，用简洁友好的中文直接回答用户的问题。不要重复展示命令本身，只给出结论和必要说明。',
      userMessage: `用户问题：${originalQuestion}\n\n执行结果：\n${outputText}\n\n请直接回答用户的问题。`
    }
  )

  return result.success ? ((result.data as string) ?? result.rawOutput ?? null) : null
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
