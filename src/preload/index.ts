/**
 * @file Preload 脚本
 * @description 通过 contextBridge 向渲染进程暴露强类型的 electronAPI。
 *              所有 IPC 通信必须在此集中声明，渲染进程不允许直接访问 Node/Electron API。
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type { ElectronAPI, SidecarResponse, SidecarNotification, AppConfig } from '../shared/types'

/** 暴露给渲染进程的安全 API */
const electronAPI: ElectronAPI = {
  invokeGit: (command: string, payload?: Record<string, unknown>): Promise<SidecarResponse> => {
    return ipcRenderer.invoke(IPC_CHANNELS.GIT_COMMAND, command, payload)
  },

  onSidecarNotification: (callback: (notification: SidecarNotification) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, notification: SidecarNotification): void => {
      callback(notification)
    }
    ipcRenderer.on(IPC_CHANNELS.SIDECAR_NOTIFICATION, handler)

    // 返回取消监听函数
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SIDECAR_NOTIFICATION, handler)
    }
  },

  loadConfig: (): Promise<AppConfig> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CONFIG_LOAD)
  },

  saveConfig: (config: AppConfig): Promise<void> => {
    return ipcRenderer.invoke(IPC_CHANNELS.CONFIG_SAVE, config)
  },

  openFolderDialog: (): Promise<string | null> => {
    return ipcRenderer.invoke(IPC_CHANNELS.DIALOG_OPEN_FOLDER)
  },

  mode: process.env.ELECTRON_MODE
}

// Use contextBridge to safely expose APIs
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', electronAPI)
  } catch (error) {
    console.error('[Preload] 暴露 API 失败:', error)
  }
} else {
  // @ts-ignore — 非隔离模式 fallback
  window.electronAPI = electronAPI
}
