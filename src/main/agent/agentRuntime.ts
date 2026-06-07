import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { LlmConfig, AgentRunRequest, AgentRunResponse, AgentPingResponse } from '../../shared/types'
import type { SidecarManager } from '../core/SidecarManager'
import { getGitToolsForTask } from './gitTools'

// ─── 常量 ─────────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function sanitizeError(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
}

/**
 * 将用户配置的 baseUrl 标准化为 OpenAI 兼容端点。
 * 确保末尾有 /v1（createOpenAI 不自动追加）。
 */
function normalizeOpenAIBaseUrl(baseUrl: string | undefined): string {
  const normalized = (baseUrl || 'https://api.openai.com').trim().replace(/\/+$/, '')
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}

function createModel(config: LlmConfig) {
  if (config.provider === 'anthropic') {
    const client = createAnthropic({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl.replace(/\/$/, '') } : {})
    })
    return client(config.modelName)
  }

  const client = createOpenAI({
    apiKey: config.apiKey,
    baseURL: normalizeOpenAIBaseUrl(config.baseUrl)
  })
  // v3 默认 client(modelId) 走 /responses（OpenAI Responses API），
  // DeepSeek / 通义等 OpenAI 兼容 API 只支持 /chat/completions，必须显式用 .chat()。
  return client.chat(config.modelName)
}

// ─── Agent 执行 ───────────────────────────────────────────────────────────────

export async function runAgentTask(
  request: AgentRunRequest,
  sidecarManager: SidecarManager
): Promise<AgentRunResponse> {
  const { config, systemPrompt, userMessage, tools: toolNames, maxIterations } = request

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  try {
    const model = createModel(config)
    const tools =
      toolNames?.length ? getGitToolsForTask(sidecarManager, toolNames) : undefined

    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: userMessage,
      ...(tools && Object.keys(tools).length
        ? { tools, maxSteps: maxIterations ?? 5 }
        : {}),
      temperature: config.temperature ?? 0.2,
      maxOutputTokens: config.maxTokens ?? 4096,
      abortSignal: controller.signal
    })

    return { success: true, rawOutput: result.text }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[AgentRuntime] runAgentTask 失败:', message)
    return { success: false, error: sanitizeError(message) }
  } finally {
    clearTimeout(timeout)
  }
}

// ─── 连通性检测 ───────────────────────────────────────────────────────────────

export async function pingLlmConfig(config: LlmConfig): Promise<AgentPingResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)

  try {
    // 使用 /models 端点而非 generateText：不消耗 token、更快、失败点更少。
    let url: string
    let headers: Record<string, string>

    if (config.provider === 'anthropic') {
      const base = config.baseUrl
        ? config.baseUrl.replace(/\/+$/, '')
        : 'https://api.anthropic.com/v1'
      url = `${base}/models`
      headers = { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }
    } else {
      url = `${normalizeOpenAIBaseUrl(config.baseUrl)}/models`
      headers = { Authorization: `Bearer ${config.apiKey}` }
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    })

    if (response.ok) {
      return { ok: true }
    }

    const body = await response.text().catch(() => '')
    // 尝试从 JSON 错误体中提取 message
    let msg = `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } }
      if (parsed.error?.message) msg = parsed.error.message
    } catch {
      if (body.trim()) msg = `${msg}: ${body.slice(0, 200)}`
    }
    return { ok: false, error: sanitizeError(msg) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: sanitizeError(message) }
  } finally {
    clearTimeout(timeout)
  }
}
