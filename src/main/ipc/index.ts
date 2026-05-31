/**
 * @file IPC 注册入口
 * @description 集中注册所有 IPC 通信处理器。新增业务模块时在此追加注册即可。
 */

import type { SidecarManager } from '../core/SidecarManager'
import { registerGitHandlers } from './gitHandlers'
import { registerConfigHandlers } from './configHandlers'
import { registerLlmHandlers } from './llmHandlers'

/** 注册全部 IPC Handlers */
export function registerAllIpcHandlers(sidecarManager: SidecarManager): void {
  registerGitHandlers(sidecarManager)
  registerConfigHandlers()
  registerLlmHandlers()
}
