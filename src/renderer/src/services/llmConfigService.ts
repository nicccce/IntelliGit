import type { LlmConfig } from '../agent/types'
import { createLlmClient } from '../agent/llmClient'
import { useLlmConfigStore } from '../store/llmConfigStore'
import { loadConfig, saveConfig } from '../api/configClient'

// ─── LLM 配置持久化 ───────────────────────────────────────────────────────────

/**
 * 保存 LLM 配置到持久化存储，并更新 store 状态。
 * 读取现有全量配置后合并写入，避免覆盖 repos/currentRepoPath。
 */
export async function saveLlmConfig(config: LlmConfig | undefined): Promise<void> {
  const current = await loadConfig()
  await saveConfig({ ...current, llmConfig: config })

  const store = useLlmConfigStore.getState()
  if (config) {
    store.setLlmConfig(config)
  } else {
    store.clearLlmConfig()
  }
}

/**
 * 从持久化存储加载 LLM 配置并写入 store。
 * 由 repositoryWorkflowService 在启动时调用。
 */
export function applyLlmConfigFromAppConfig(llmConfig: LlmConfig | undefined): void {
  const store = useLlmConfigStore.getState()
  if (llmConfig) {
    store.setLlmConfig(llmConfig)
  } else {
    store.setStatus('unconfigured')
  }
}

// ─── LLM 连接状态检测 ─────────────────────────────────────────────────────────

/**
 * 检测当前配置的 LLM 是否可用（发送最小请求）。
 * 结果写入 llmConfigStore。
 */
export async function checkLlmConnection(): Promise<void> {
  const store = useLlmConfigStore.getState()
  const config = store.config

  if (!config || !config.apiKey) {
    store.setStatus('unconfigured')
    return
  }

  store.setStatus('checking')

  try {
    const client = createLlmClient(config)
    await client.ping()
    store.setStatus('ready')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    store.setStatus('error', `连接失败: ${message}`)
  }
}

// ─── 便捷读取 ─────────────────────────────────────────────────────────────────

/** 获取当前生效的 LLM 配置（供 Agent Runtime 使用） */
export function getCurrentLlmConfig(): LlmConfig | undefined {
  return useLlmConfigStore.getState().config
}
