import { create } from 'zustand'

import type { ShadowMergeResult } from '../../../shared/types'
import { invokeGit } from '../api/gitClient'

export type ShadowMergeStatus = 'idle' | 'pending' | 'done' | 'error'

export interface ShadowMergeBranchState {
  status: ShadowMergeStatus
  result: ShadowMergeResult | null
}

export interface ShadowMergeStoreState {
  /** 每个分支名 → 预检状态和结果 */
  branchResults: Record<string, ShadowMergeBranchState>

  /** 对单个分支执行影子合并预检 */
  checkBranch: (targetBranch: string) => Promise<void>

  /** 对一批分支依次执行预检（非阻塞，逐个更新 store） */
  checkAllBranches: (branches: string[]) => Promise<void>

  /** 清空所有预检结果（切换仓库时调用） */
  clearResults: () => void
}

export const useShadowMergeStore = create<ShadowMergeStoreState>((set, get) => ({
  branchResults: {},

  checkBranch: async (targetBranch: string) => {
    // 标记为进行中
    set((state) => ({
      branchResults: {
        ...state.branchResults,
        [targetBranch]: { status: 'pending', result: null }
      }
    }))

    try {
      const result = await invokeGit('merge.shadow', { targetBranch })
      set((state) => ({
        branchResults: {
          ...state.branchResults,
          [targetBranch]: { status: 'done', result }
        }
      }))
    } catch (err) {
      console.warn(`[ShadowMergeStore] ${targetBranch} 预检失败:`, err)
      set((state) => ({
        branchResults: {
          ...state.branchResults,
          [targetBranch]: { status: 'error', result: null }
        }
      }))
    }
  },

  checkAllBranches: async (branches: string[]) => {
    // 过滤掉已经在进行中的分支，避免重复请求
    const { branchResults } = get()
    const toCheck = branches.filter((b) => branchResults[b]?.status !== 'pending')

    for (const branch of toCheck) {
      await get().checkBranch(branch)
    }
  },

  clearResults: () => set({ branchResults: {} })
}))
