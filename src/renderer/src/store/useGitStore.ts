/**
 * @file Git 命令状态管理（Zustand）
 * @description 管理 Git 命令的调用状态、历史记录和最近一次响应。
 */

import { create } from 'zustand'

/** 单条命令记录 */
export interface CommandRecord {
  id: number
  command: string
  payload?: Record<string, unknown>
  response: unknown
  timestamp: number
  success: boolean
}

export interface GitStoreState {
  /** 是否正在请求中 */
  loading: boolean
  /** 命令执行历史 */
  history: CommandRecord[]
  /** 错误信息 */
  error: string | null

  /** 执行 Git 命令 */
  executeCommand: (command: string, payload?: Record<string, unknown>) => Promise<void>
  /** 清空历史 */
  clearHistory: () => void
}

let idCounter = 0

export const useGitStore = create<GitStoreState>((set) => ({
  loading: false,
  history: [],
  error: null,

  executeCommand: async (command, payload) => {
    set({ loading: true, error: null })

    try {
      const response = await window.electronAPI.invokeGit(command, payload)
      const record: CommandRecord = {
        id: ++idCounter,
        command,
        payload,
        response,
        timestamp: Date.now(),
        success: !response.error
      }
      set((state) => ({
        loading: false,
        history: [record, ...state.history]
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set({ loading: false, error: message })
    }
  },

  clearHistory: () => set({ history: [], error: null })
}))
