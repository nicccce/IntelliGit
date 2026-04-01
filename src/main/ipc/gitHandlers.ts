/**
 * @file Git IPC Handlers
 * @description 注册 git:command IPC 通道，将渲染进程的请求转发给 SidecarManager。
 */

import { ipcMain } from 'electron'
import { IPC_CHANNELS, type SidecarResponse } from '../../shared/types'
import type { SidecarManager } from '../core/SidecarManager'

/**
 * 注册所有 Git 相关的 IPC 处理器
 * @param sidecarManager - SidecarManager 实例
 */
export function registerGitHandlers(sidecarManager: SidecarManager): void {
  ipcMain.handle(
    IPC_CHANNELS.GIT_COMMAND,
    async (_event, command: string, payload?: Record<string, unknown>): Promise<SidecarResponse> => {
      console.log(`[IPC] git:command 收到请求 command="${command}"`, payload)

      try {
        if (!sidecarManager.isRunning) {
          return {
            id: '',
            success: false,
            error: 'Sidecar 进程未运行。请确保 Go 二进制文件已放置在 resources/ 目录下。'
          }
        }
        const response = await sidecarManager.send(command, payload)
        return response
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[IPC] git:command 处理失败:`, message)
        return {
          id: '',
          success: false,
          error: message
        }
      }
    }
  )
}
