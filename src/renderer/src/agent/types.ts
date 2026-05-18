import type { LlmConfig, LlmProvider } from '../../../shared/types'

export type { LlmConfig, LlmProvider }

// ─── Agent 运行状态 ───────────────────────────────────────────────────────────

export type AgentStatus = 'unconfigured' | 'checking' | 'ready' | 'error'

export interface LlmConnectionStatus {
  status: AgentStatus
  error?: string
  checkedAt?: number
}

// ─── 风险分级 ─────────────────────────────────────────────────────────────────

/** safe: 可直接执行 | high: 需二次确认 | extreme: 默认阻止 */
export type RiskLevel = 'safe' | 'high' | 'extreme'

// ─── Tool 系统 ────────────────────────────────────────────────────────────────

export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  description?: string
  enum?: string[]
  properties?: Record<string, ToolParameterSchema>
  items?: ToolParameterSchema
  required?: string[]
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, ToolParameterSchema>
    required?: string[]
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface RegisteredTool<TInput = any, TOutput = any> {
  definition: ToolDefinition
  execute: (input: TInput) => Promise<TOutput>
}

// ─── Agent 消息 ───────────────────────────────────────────────────────────────

export interface AgentToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  toolCallId?: string
  toolCalls?: AgentToolCall[]
}

// ─── Agent 任务 / 结果 ────────────────────────────────────────────────────────

export interface AgentTask {
  /** 任务类型标识，用于 Fallback 分派 */
  taskType: 'commit' | 'conflict' | 'nl_assistant' | string
  systemPrompt: string
  userMessage: string
  /** 要启用的 Tool 名称列表（空 = 不使用 Tool） */
  tools?: string[]
  /** 最大工具调用轮次，默认 5 */
  maxIterations?: number
  /** 额外上下文（传给 Prompt 模板的键值对） */
  context?: Record<string, unknown>
}

export interface AgentResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
  /** true 表示 LLM 不可用时使用了模板降级结果 */
  fallback?: boolean
  riskLevel?: RiskLevel
  /** true 表示高危操作需要用户二次确认 */
  requiresConfirmation?: boolean
  confirmationMessage?: string
  rawOutput?: string
}
