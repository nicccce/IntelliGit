import type { LlmConfig, AgentMessage, AgentToolCall, ToolDefinition } from './types'

// ─── 统一 LLM 响应结构 ────────────────────────────────────────────────────────

export interface LlmResponse {
  content: string
  toolCalls?: AgentToolCall[]
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error'
}

// ─── 抽象接口 ─────────────────────────────────────────────────────────────────

export interface LlmClient {
  chat(messages: AgentMessage[], tools?: ToolDefinition[]): Promise<LlmResponse>
  ping(): Promise<void>
}

// ─── OpenAI 兼容客户端（覆盖 OpenAI / DeepSeek / 通义 / 本地模型等） ──────────

interface OpenAIMessage {
  role: string
  content: string | null
  tool_call_id?: string
  tool_calls?: OpenAIToolCall[]
}

interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null
      tool_calls?: OpenAIToolCall[]
    }
    finish_reason: string
  }>
}

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com'

function normalizeOpenAIBaseUrl(baseUrl: string | undefined): string {
  const normalized = (baseUrl || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, '')
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}

function buildOpenAIEndpoint(baseUrl: string): string {
  return `${baseUrl}/chat/completions`
}

function sanitizeLlmError(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
}

function toOpenAIMessages(messages: AgentMessage[]): OpenAIMessage[] {
  return messages.map((msg) => {
    if (msg.role === 'tool') {
      return { role: 'tool', content: msg.content, tool_call_id: msg.toolCallId! }
    }
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      return {
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
        }))
      }
    }
    return { role: msg.role, content: msg.content }
  })
}

function toOpenAITools(tools: ToolDefinition[]): Array<{
  type: 'function'
  function: {
    name: string
    description: string
    parameters: ToolDefinition['parameters']
  }
}> {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
}

class OpenAICompatibleClient implements LlmClient {
  private readonly baseUrl: string
  private readonly config: LlmConfig

  constructor(config: LlmConfig) {
    this.config = config
    this.baseUrl = normalizeOpenAIBaseUrl(config.baseUrl)
  }

  async chat(messages: AgentMessage[], tools?: ToolDefinition[]): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model: this.config.modelName,
      messages: toOpenAIMessages(messages),
      temperature: this.config.temperature ?? 0.2,
      max_tokens: this.config.maxTokens ?? 4096
    }
    if (tools?.length) {
      body.tools = toOpenAITools(tools)
      body.tool_choice = 'auto'
    }

    const res = await window.electronAPI.proxyLlmRequest({
      url: buildOpenAIEndpoint(this.baseUrl),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      throw new Error(`LLM 请求失败 ${res.status}: ${sanitizeLlmError(res.body || res.statusText)}`)
    }

    const data = JSON.parse(res.body) as OpenAIResponse
    const choice = data.choices[0]
    const rawToolCalls = choice.message.tool_calls

    const toolCalls: AgentToolCall[] | undefined = rawToolCalls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: (() => {
        try {
          return JSON.parse(tc.function.arguments) as Record<string, unknown>
        } catch {
          return {}
        }
      })()
    }))

    return {
      content: choice.message.content ?? '',
      toolCalls,
      finishReason:
        choice.finish_reason === 'tool_calls'
          ? 'tool_calls'
          : choice.finish_reason === 'length'
            ? 'length'
            : 'stop'
    }
  }

  async ping(): Promise<void> {
    await this.chat([{ role: 'user', content: 'ping' }])
  }
}

// ─── Anthropic 客户端 ─────────────────────────────────────────────────────────

interface AnthropicContent {
  type: 'text' | 'tool_use'
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}

interface AnthropicResponse {
  content: AnthropicContent[]
  stop_reason: string
}

type AnthropicContentBlock = Record<string, unknown>

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

function toAnthropicMessages(messages: AgentMessage[]): {
  system: string
  msgs: AnthropicMessage[]
} {
  let system = ''
  const msgs: AnthropicMessage[] = []

  for (const msg of messages) {
    if (msg.role === 'system') {
      system = msg.content
      continue
    }
    if (msg.role === 'tool') {
      const last = msgs[msgs.length - 1]
      const block: AnthropicContentBlock = {
        type: 'tool_result',
        tool_use_id: msg.toolCallId!,
        content: msg.content
      }
      if (last?.role === 'user' && Array.isArray(last.content)) {
        ;(last.content as AnthropicContentBlock[]).push(block)
      } else {
        msgs.push({ role: 'user', content: [block] })
      }
      continue
    }
    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      const blocks: AnthropicContentBlock[] = []
      if (msg.content) blocks.push({ type: 'text', text: msg.content })
      for (const tc of msg.toolCalls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments })
      }
      msgs.push({ role: 'assistant', content: blocks })
      continue
    }
    msgs.push({ role: msg.role as 'user' | 'assistant', content: msg.content })
  }

  return { system, msgs }
}

class AnthropicClient implements LlmClient {
  private readonly config: LlmConfig

  constructor(config: LlmConfig) {
    this.config = config
  }

  async chat(messages: AgentMessage[], tools?: ToolDefinition[]): Promise<LlmResponse> {
    const { system, msgs } = toAnthropicMessages(messages)

    const body: Record<string, unknown> = {
      model: this.config.modelName,
      messages: msgs,
      max_tokens: this.config.maxTokens ?? 4096,
      temperature: this.config.temperature ?? 0.2
    }
    if (system) body.system = system
    if (tools?.length) {
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters
      }))
    }

    const baseUrl = (this.config.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')
    const res = await window.electronAPI.proxyLlmRequest({
      url: `${baseUrl}/v1/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    })

    if (!res.ok) {
      throw new Error(`LLM 请求失败 ${res.status}: ${sanitizeLlmError(res.body || res.statusText)}`)
    }

    const data = JSON.parse(res.body) as AnthropicResponse
    const textBlocks = data.content.filter((c) => c.type === 'text')
    const toolBlocks = data.content.filter((c) => c.type === 'tool_use')

    const toolCalls: AgentToolCall[] | undefined = toolBlocks.length
      ? toolBlocks.map((b) => ({ id: b.id!, name: b.name!, arguments: b.input ?? {} }))
      : undefined

    return {
      content: textBlocks.map((b) => b.text ?? '').join('\n'),
      toolCalls,
      finishReason:
        data.stop_reason === 'tool_use'
          ? 'tool_calls'
          : data.stop_reason === 'max_tokens'
            ? 'length'
            : 'stop'
    }
  }

  async ping(): Promise<void> {
    await this.chat([{ role: 'user', content: 'ping' }])
  }
}

// ─── 工厂函数 ─────────────────────────────────────────────────────────────────

export function createLlmClient(config: LlmConfig): LlmClient {
  if (config.provider === 'anthropic') return new AnthropicClient(config)
  return new OpenAICompatibleClient(config)
}
