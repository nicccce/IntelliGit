import type { RiskLevel } from './types'

// ─── 极高危操作规则 ───────────────────────────────────────────────────────────

interface ExtremeRiskRule {
  pattern: RegExp
  reason: string
}

const EXTREME_RISK_RULES: ExtremeRiskRule[] = [
  {
    pattern: /push.*--force.*(?:main|master)/i,
    reason: '向主分支强制推送会覆盖远程历史，无法恢复'
  },
  {
    pattern: /push.*-f.*(?:main|master)/i,
    reason: '向主分支强制推送会覆盖远程历史，无法恢复'
  },
  {
    pattern: /clean\s+-[a-z]*f/i,
    reason: 'git clean -f 会永久删除未跟踪文件，不可恢复'
  },
  {
    pattern: /reset\s+--hard\s+HEAD/i,
    reason: 'reset --hard 会丢弃所有未提交的工作区变更'
  },
  {
    pattern: /branch\s+-[Dd]\s+(?:main|master|develop)/i,
    reason: '删除主要保护分支可能造成严重损失'
  }
]

// ─── 高危操作规则 ─────────────────────────────────────────────────────────────

interface HighRiskRule {
  pattern: RegExp
  reason: string
}

const HIGH_RISK_RULES: HighRiskRule[] = [
  { pattern: /push.*--force/i, reason: '强制推送会覆盖远程提交历史' },
  { pattern: /push.*-f\b/i, reason: '强制推送会覆盖远程提交历史' },
  { pattern: /reset\s+--hard/i, reason: '硬重置会丢弃工作区变更' },
  { pattern: /reset\s+--mixed\s+HEAD~\d+/i, reason: '回退多个提交需要确认' },
  { pattern: /rebase\s+/i, reason: 'rebase 会重写提交历史' },
  { pattern: /cherry-pick\s+/i, reason: 'cherry-pick 涉及提交历史变更' },
  { pattern: /branch\s+-[Dd]\s+/i, reason: '删除分支操作' },
  { pattern: /stash\s+drop/i, reason: '删除 stash 后无法恢复' },
  { pattern: /stash\s+clear/i, reason: '清空所有 stash 后无法恢复' },
  { pattern: /tag\s+-d\s+/i, reason: '删除 tag 操作' }
]

// ─── Safety API ───────────────────────────────────────────────────────────────

export interface SafetyCheckResult {
  riskLevel: RiskLevel
  reason?: string
  blocked: boolean
}

/**
 * 对 Git 命令字符串进行风险评估。
 * command 应包含完整命令（如 "push --force origin main"，不需要含 "git " 前缀）。
 */
export function checkCommandRisk(command: string): SafetyCheckResult {
  for (const rule of EXTREME_RISK_RULES) {
    if (rule.pattern.test(command)) {
      return { riskLevel: 'extreme', reason: rule.reason, blocked: true }
    }
  }

  for (const rule of HIGH_RISK_RULES) {
    if (rule.pattern.test(command)) {
      return { riskLevel: 'high', reason: rule.reason, blocked: false }
    }
  }

  return { riskLevel: 'safe', blocked: false }
}

/**
 * 对操作计划数组（来自 NL 助手）进行批量检查，返回整体最高风险等级。
 */
export function checkOperationPlanRisk(
  operations: Array<{ command: string; args?: string[] }>
): SafetyCheckResult {
  let highestRisk: SafetyCheckResult = { riskLevel: 'safe', blocked: false }

  for (const op of operations) {
    const fullCommand = [op.command, ...(op.args ?? [])].join(' ')
    const result = checkCommandRisk(fullCommand)

    if (result.riskLevel === 'extreme') return result
    if (result.riskLevel === 'high' && highestRisk.riskLevel !== 'extreme') {
      highestRisk = result
    }
  }

  return highestRisk
}

/** 构建用于展示给用户的确认消息 */
export function buildConfirmationMessage(command: string, reason: string): string {
  return `即将执行：git ${command}\n\n⚠️ 风险提示：${reason}\n\n请确认是否继续？`
}
