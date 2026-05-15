import { create } from 'zustand'

import type { PatchDetail } from '../../../shared/types'
import { invokeGit } from '../api/gitClient'

export interface DiffStoreState {
  selectedFilePath: string | null
  workdirDiff: PatchDetail | null
  clearDiffState: () => void
  selectFile: (path: string) => Promise<void>
  fetchRawDiff: (path: string) => Promise<string>
}

const EMPTY_DIFF_STATE = {
  selectedFilePath: null,
  workdirDiff: null
}

export const useDiffStore = create<DiffStoreState>((set) => ({
  ...EMPTY_DIFF_STATE,

  clearDiffState: () => set(EMPTY_DIFF_STATE),

  selectFile: async (path) => {
    set({ selectedFilePath: path, workdirDiff: null })
    try {
      const workdirDiff = await invokeGit('diff.workdir', { path })
      set({ workdirDiff })
    } catch (err) {
      console.error('[DiffStore] selectFile diff 失败:', err)
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
