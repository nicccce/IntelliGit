import { create } from 'zustand'

import type { PatchDetail } from '../../../shared/types'
import { invokeGit } from '../api/gitClient'

export type DiffSource = 'unstaged' | 'staged'

export interface DiffStoreState {
  selectedFilePath: string | null
  diffSource: DiffSource | null
  workdirDiff: PatchDetail | null
  stagedDiff: PatchDetail | null
  clearDiffState: () => void
  selectFile: (path: string, source: DiffSource) => Promise<void>
  refreshCurrentDiff: () => Promise<void>
  fetchRawDiff: (path: string) => Promise<string>
}

const EMPTY_DIFF_STATE = {
  selectedFilePath: null,
  diffSource: null,
  workdirDiff: null,
  stagedDiff: null
}

export const useDiffStore = create<DiffStoreState>((set, get) => ({
  ...EMPTY_DIFF_STATE,

  clearDiffState: () => set(EMPTY_DIFF_STATE),

  selectFile: async (path, source) => {
    const currentSelected = get().selectedFilePath
    if (path === currentSelected && get().diffSource === source) {
      set(EMPTY_DIFF_STATE)
      return
    }
    // 根据来源清空对应的 diff 数据（用户主动切换时显示加载中是可接受的）
    if (source === 'unstaged') {
      set({ selectedFilePath: path, diffSource: source, workdirDiff: null })
    } else {
      set({ selectedFilePath: path, diffSource: source, stagedDiff: null })
    }
    try {
      if (source === 'unstaged') {
        const workdirDiff = await invokeGit('diff.workdir', { path })
        set({ workdirDiff })
      } else {
        const stagedDiff = await invokeGit('diff.staged', { path })
        set({ stagedDiff })
      }
    } catch (err) {
      console.error('[DiffStore] selectFile diff 失败:', err)
    }
  },

  /**
   * 静默刷新当前 diff：不先清空数据，避免闪烁。
   * 请求成功后直接替换，请求失败则保留旧数据。
   */
  refreshCurrentDiff: async () => {
    const { selectedFilePath, diffSource } = get()
    if (!selectedFilePath || !diffSource) return
    try {
      if (diffSource === 'unstaged') {
        const workdirDiff = await invokeGit('diff.workdir', { path: selectedFilePath })
        set({ workdirDiff })
      } else {
        const stagedDiff = await invokeGit('diff.staged', { path: selectedFilePath })
        set({ stagedDiff })
      }
    } catch (err) {
      console.error('[DiffStore] refreshCurrentDiff 失败:', err)
      // 失败时保留旧 diff，不更新
    }
  },

  fetchRawDiff: async (path) => {
    try {
      const result = await invokeGit('diff.workdirRaw', { path })
      return result.diff
    } catch (err) {
      console.error('[DiffStore] fetchRawDiff 失败:', err)
      return ''
    }
  }
}))
