import { create } from 'zustand'

import type { PatchDetail } from '../../../shared/types'
import { invokeGit } from '../api/gitClient'
import { withOperation } from './operationStore'
import { useGitStatusStore } from './gitStatusStore'
import { useUiStore } from './uiStore'

interface DiffStoreState {
  selectedFilePath: string | null
  workdirDiff: PatchDetail | null
  clearDiffState: () => void
  selectFile: (path: string) => Promise<void>
  applyPatch: (patch: string) => Promise<void>
  unstageHunk: (patch: string) => Promise<void>
  fetchRawDiff: (path: string) => Promise<string>
}

const EMPTY_DIFF_STATE = {
  selectedFilePath: null,
  workdirDiff: null
}

export const useDiffStore = create<DiffStoreState>((set, get) => ({
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

  applyPatch: async (patch) => {
    try {
      await withOperation('staging.applyPatch', async () => {
        await invokeGit('staging.applyPatch', { patch })
        await useGitStatusStore.getState().refreshStatus()
        const { selectedFilePath } = get()
        if (selectedFilePath) {
          await get().selectFile(selectedFilePath)
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useUiStore.getState().setError(`Hunk 暂存失败: ${message}`)
    }
  },

  unstageHunk: async (patch) => {
    try {
      await withOperation('staging.unstageHunk', async () => {
        await invokeGit('staging.unstageHunk', { patch })
        await useGitStatusStore.getState().refreshStatus()
        const { selectedFilePath } = get()
        if (selectedFilePath) {
          await get().selectFile(selectedFilePath)
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useUiStore.getState().setError(`取消 Hunk 暂存失败: ${message}`)
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
