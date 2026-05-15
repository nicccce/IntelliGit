import { create } from 'zustand'

import type { CommitRecord, DiffEntry, PatchDetail } from '../../../shared/types'
import { invokeGit } from '../api/gitClient'

interface HistoryStoreState {
  commitHistory: CommitRecord[]
  allCommitHistory: CommitRecord[]
  selectedCommit: CommitRecord | null
  selectedCommitFiles: DiffEntry[]
  diffCompareResult: PatchDetail | null
  clearHistoryState: () => void
  refreshHistory: () => Promise<void>
  fetchAllHistory: () => Promise<void>
  selectCommit: (commit: CommitRecord | null) => Promise<void>
  diffTwoCommits: (hashA: string, hashB: string) => Promise<void>
  clearSelectedCommit: () => void
}

const EMPTY_HISTORY_STATE = {
  commitHistory: [],
  allCommitHistory: [],
  selectedCommit: null,
  selectedCommitFiles: [],
  diffCompareResult: null
}

export const useHistoryStore = create<HistoryStoreState>((set) => ({
  ...EMPTY_HISTORY_STATE,

  clearHistoryState: () => set(EMPTY_HISTORY_STATE),

  refreshHistory: async () => {
    try {
      const commitHistory = await invokeGit('commit.log', { max: 50 })
      set({ commitHistory: commitHistory || [] })
    } catch (err) {
      console.error('[HistoryStore] refreshHistory 失败:', err)
    }
  },

  fetchAllHistory: async () => {
    try {
      const allCommitHistory = await invokeGit('commit.logAll', { max: 200 })
      set({ allCommitHistory: allCommitHistory || [] })
    } catch (err) {
      console.error('[HistoryStore] fetchAllHistory 失败:', err)
    }
  },

  selectCommit: async (commit) => {
    set({ selectedCommit: commit, selectedCommitFiles: [] })
    if (!commit) return

    try {
      const selectedCommitFiles = await invokeGit('diff.withParent', { hash: commit.hash })
      set({ selectedCommitFiles: selectedCommitFiles || [] })
    } catch (err) {
      console.error('[HistoryStore] selectCommit 失败:', err)
    }
  },

  diffTwoCommits: async (hashA, hashB) => {
    set({ diffCompareResult: null })
    try {
      const diffCompareResult = await invokeGit('diff.commits', { hashA, hashB })
      set({ diffCompareResult })
    } catch (err) {
      console.error('[HistoryStore] diffTwoCommits 失败:', err)
    }
  },

  clearSelectedCommit: () =>
    set({ selectedCommit: null, selectedCommitFiles: [], diffCompareResult: null })
}))
