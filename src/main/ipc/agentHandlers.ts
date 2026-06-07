import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/types'
import type { AgentRunRequest, LlmConfig } from '../../shared/types'
import type { SidecarManager } from '../core/SidecarManager'
import { runAgentTask, pingLlmConfig } from '../agent/agentRuntime'

export function registerAgentHandlers(sidecarManager: SidecarManager): void {
  ipcMain.handle(
    IPC_CHANNELS.AGENT_RUN_TASK,
    async (_event, request: AgentRunRequest) => {
      return runAgentTask(request, sidecarManager)
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.AGENT_PING_LLM,
    async (_event, config: LlmConfig) => {
      return pingLlmConfig(config)
    }
  )
}
