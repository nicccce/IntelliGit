/**
 * @file Git IPC Handlers
 * @description 注册 git:command IPC 通道，将渲染进程的请求转发给 SidecarManager。
 *              同时监听 Sidecar 通知事件并转发给渲染进程。
 */

import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNELS, type SidecarResponse, type SidecarNotification } from '../../shared/types'
import type { SidecarManager } from '../core/SidecarManager'

/**
 * 注册所有 Git 相关的 IPC 处理器
 * @param sidecarManager - SidecarManager 实例
 */
export function registerGitHandlers(sidecarManager: SidecarManager): void {
  // ── git:command — 渲染进程发起的命令请求 ──────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.GIT_COMMAND,
    async (_event, command: string, payload?: Record<string, unknown>): Promise<SidecarResponse> => {
      console.log(`[IPC] git:command 收到请求 command="${command}"`, payload == undefined ? '{}' : payload)

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

  // ── sidecar:notification — Sidecar 主动推送转发到渲染进程 ───────────────
  sidecarManager.on('notification', (notification: SidecarNotification) => {
    // 将通知转发到所有渲染进程窗口
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.SIDECAR_NOTIFICATION, notification)
      }
    }
  })
}
