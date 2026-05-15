import { create } from 'zustand'

import type { BranchInfo, FileStatusInfo, RepoConfig } from '../../../shared/types'
import { invokeGit } from '../api/gitClient'
import { buildRemotePayload } from '../services/remoteService'

interface GitStatusStoreState {
  fileStatuses: FileStatusInfo[]
  currentBranch: string
  branches: BranchInfo[]
  remoteBranches: BranchInfo[]
  commitsAhead: number
  commitsBehind: number
  clearGitStatus: () => void
  refreshStatus: () => Promise<void>
  refreshBranchState: () => Promise<void>
  refreshRemote: (repo: RepoConfig | null) => Promise<void>
}

const EMPTY_GIT_STATUS = {
  fileStatuses: [],
  currentBranch: '',
  branches: [],
  remoteBranches: [],
  commitsAhead: 0,
  commitsBehind: 0
}

function filterRemoteBranches(branches: BranchInfo[]): BranchInfo[] {
  return branches.filter((branch) => branch.name !== 'HEAD' && !branch.name.endsWith('/HEAD'))
}

export const useGitStatusStore = create<GitStatusStoreState>((set) => ({
  ...EMPTY_GIT_STATUS,

  clearGitStatus: () => set(EMPTY_GIT_STATUS),

  refreshStatus: async () => {
    try {
      const fileStatuses = await invokeGit('staging.status')
      set({ fileStatuses: fileStatuses || [] })
    } catch (err) {
      console.error('[GitStatusStore] refreshStatus 失败:', err)
    }
  },

  refreshBranchState: async () => {
    try {
      const [branches, currentBranchResult] = await Promise.all([
        invokeGit('branch.list'),
        invokeGit('branch.current')
      ])

      const currentBranch = currentBranchResult.branch
      set({ branches: branches || [], currentBranch })

      if (!currentBranch) {
        set({ commitsAhead: 0, commitsBehind: 0 })
        return
      }

      try {
        const aheadBehind = await invokeGit('branch.aheadBehind', { branch: currentBranch })
        set({ commitsAhead: aheadBehind.ahead, commitsBehind: aheadBehind.behind })
      } catch {
        set({ commitsAhead: 0, commitsBehind: 0 })
      }
    } catch (err) {
      console.error('[GitStatusStore] refreshBranchState 失败:', err)
    }
  },

  refreshRemote: async (repo) => {
    try {
      if (repo) {
        await invokeGit('remote.fetch', buildRemotePayload(repo))
      }

      const [branches, remoteBranches, currentBranchResult] = await Promise.all([
        invokeGit('branch.list'),
        invokeGit('branch.listRemote'),
        invokeGit('branch.current')
      ])

      const currentBranch = currentBranchResult.branch
      set({
        branches: branches || [],
        remoteBranches: filterRemoteBranches(remoteBranches || []),
        currentBranch
      })

      if (!currentBranch) {
        set({ commitsAhead: 0, commitsBehind: 0 })
        return
      }

      try {
        const aheadBehind = await invokeGit('branch.aheadBehind', { branch: currentBranch })
        set({ commitsAhead: aheadBehind.ahead, commitsBehind: aheadBehind.behind })
      } catch {
        set({ commitsAhead: 0, commitsBehind: 0 })
      }
    } catch (err) {
      console.error('[GitStatusStore] refreshRemote 失败:', err)
    }
  }
}))

export function hasLocalBranch(branch: string): boolean {
  return useGitStatusStore.getState().branches.some((item) => item.name === branch)
}

export function findRemoteBranch(branch: string): BranchInfo | undefined {
  const remoteRefName = `origin/${branch}`
  return useGitStatusStore.getState().remoteBranches.find((item) => item.name === remoteRefName)
}
