/**
 * @file 应用状态管理（Zustand）
 * @description 管理仓库列表、当前仓库、配置持久化、Git 状态等全局状态。
 */

import { create } from 'zustand'
import type { RepoConfig, AppConfig } from '../../../shared/types'

/** 文件状态信息 */
export interface FileStatusInfo {
  path: string
  staging: string
  worktree: string
}

/** 提交记录 */
export interface CommitRecord {
  hash: string
  shortHash: string
  author: string
  authorEmail: string
  date: string
  message: string
  parentHashes: string[]
}

/** 分支信息 */
export interface BranchInfo {
  name: string
  isRemote: boolean
  isHead: boolean
  hash: string
}

interface AppStoreState {
  // ── 配置状态 ─────────────────────────────────────────────
  /** 仓库列表 */
  repos: RepoConfig[]
  /** 当前活跃仓库 */
  currentRepo: RepoConfig | null
  /** 配置是否已加载 */
  configLoaded: boolean

  // ── Git 状态 ─────────────────────────────────────────────
  /** 文件状态列表 */
  fileStatuses: FileStatusInfo[]
  /** 提交历史 */
  commitHistory: CommitRecord[]
  /** 当前分支 */
  currentBranch: string
  /** 分支列表 */
  branches: BranchInfo[]
  /** 待 Push 的提交数 */
  commitsAhead: number
  /** 待 Pull 的提交数 */
  commitsBehind: number

  // ── UI 状态 ─────────────────────────────────────────────
  /** 全局加载状态 */
  loading: boolean
  /** 操作加载状态（具体操作） */
  operationLoading: string | null
  /** 错误信息 */
  error: string | null
  /** 成功消息 */
  successMessage: string | null
  /** 当前视图 */
  activeView: 'changes' | 'history' | 'settings'

  // ── 配置操作 ─────────────────────────────────────────────
  /** 初始化加载配置 */
  loadConfig: () => Promise<void>
  /** 添加仓库 */
  addRepo: (path: string) => Promise<void>
  /** 移除仓库 */
  removeRepo: (path: string) => Promise<void>
  /** 切换当前仓库 */
  switchRepo: (path: string) => Promise<void>
  /** 更新仓库设置 */
  updateRepoSettings: (path: string, settings: Partial<RepoConfig>) => Promise<void>

  // ── Git 操作 ─────────────────────────────────────────────
  /** 刷新仓库状态 */
  refreshStatus: () => Promise<void>
  /** 刷新提交历史 */
  refreshHistory: () => Promise<void>
  /** 刷新分支信息 */
  refreshBranches: () => Promise<void>
  /** 全量刷新 */
  refreshAll: () => Promise<void>
  /** Add 文件到暂存区 */
  addFile: (path: string) => Promise<void>
  /** Add 所有文件 */
  addAll: () => Promise<void>
  /** 从暂存区移除 */
  removeFile: (path: string) => Promise<void>
  /** 创建 Commit */
  createCommit: (message: string) => Promise<void>
  /** Push */
  push: () => Promise<void>
  /** Pull */
  pull: () => Promise<void>
  /** 切换分支 */
  checkoutBranch: (branch: string) => Promise<void>

  // ── UI 操作 ──────────────────────────────────────────────
  /** 设置活跃视图 */
  setActiveView: (view: 'changes' | 'history' | 'settings') => void
  /** 清除错误 */
  clearError: () => void
  /** 清除成功消息 */
  clearSuccess: () => void
}

/** 从路径中提取仓库名称 */
function repoNameFromPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || p
}

/** 持久化保存配置 */
async function persistConfig(repos: RepoConfig[], currentRepoPath: string | null): Promise<void> {
  const config: AppConfig = { repos, currentRepoPath }
  await window.electronAPI.saveConfig(config)
}

function cleanSetting(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized || undefined
}

function remotePayload(repo: RepoConfig | null): Record<string, unknown> {
  const payload: Record<string, unknown> = { remote: 'origin' }
  if (repo?.authUsername) payload.username = repo.authUsername
  if (repo?.authPassword) payload.password = repo.authPassword
  if (repo?.sshKeyPath) payload.sshKeyPath = repo.sshKeyPath
  if (repo?.sshPassword) payload.sshPassword = repo.sshPassword
  return payload
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  repos: [],
  currentRepo: null,
  configLoaded: false,
  fileStatuses: [],
  commitHistory: [],
  currentBranch: '',
  branches: [],
  commitsAhead: 0,
  commitsBehind: 0,
  loading: false,
  operationLoading: null,
  error: null,
  successMessage: null,
  activeView: 'changes',

  // ── 配置操作 ─────────────────────────────────────────────

  loadConfig: async () => {
    try {
      const config = await window.electronAPI.loadConfig()
      const currentRepo = config.currentRepoPath
        ? config.repos.find((r) => r.path === config.currentRepoPath) || null
        : null
      set({ repos: config.repos, currentRepo, configLoaded: true })

      // 如果有当前仓库，尝试打开并刷新
      if (currentRepo) {
        const state = get()
        try {
          await window.electronAPI.invokeGit('repo.open', { path: currentRepo.path })
          await state.refreshAll()
        } catch {
          console.warn('[AppStore] 打开仓库失败，可能路径无效')
        }
      }
    } catch (err) {
      console.error('[AppStore] 加载配置失败:', err)
      set({ configLoaded: true })
    }
  },

  addRepo: async (path: string) => {
    const { repos } = get()
    if (repos.find((r) => r.path === path)) {
      set({ error: '该仓库已存在' })
      return
    }

    // 尝试打开仓库验证
    const response = await window.electronAPI.invokeGit('repo.open', { path })
    if (!response.success) {
      set({ error: `无法打开仓库: ${response.error}` })
      return
    }

    const newRepo: RepoConfig = { path, name: repoNameFromPath(path) }
    const newRepos = [...repos, newRepo]
    set({ repos: newRepos, currentRepo: newRepo, error: null })
    await persistConfig(newRepos, path)

    // 刷新
    const state = get()
    await state.refreshAll()
  },

  removeRepo: async (path: string) => {
    const { repos, currentRepo } = get()
    const newRepos = repos.filter((r) => r.path !== path)
    const newCurrent = currentRepo?.path === path ? null : currentRepo
    set({
      repos: newRepos,
      currentRepo: newCurrent,
      fileStatuses: newCurrent ? get().fileStatuses : [],
      commitHistory: newCurrent ? get().commitHistory : [],
      currentBranch: newCurrent ? get().currentBranch : '',
      branches: newCurrent ? get().branches : []
    })
    await persistConfig(newRepos, newCurrent?.path || null)
  },

  switchRepo: async (path: string) => {
    const { repos } = get()
    const repo = repos.find((r) => r.path === path)
    if (!repo) return

    set({ loading: true, error: null })
    try {
      const response = await window.electronAPI.invokeGit('repo.open', { path })
      if (!response.success) {
        set({ error: `切换仓库失败: ${response.error}`, loading: false })
        return
      }
      set({ currentRepo: repo })
      await persistConfig(repos, path)
      const state = get()
      await state.refreshAll()
    } catch (err) {
      set({ error: `切换仓库失败: ${err}`, loading: false })
    }
  },

  updateRepoSettings: async (path: string, settings: Partial<RepoConfig>) => {
    const { repos, currentRepo } = get()
    const newRepos = repos.map((r) => (r.path === path ? { ...r, ...settings } : r))
    const newCurrent = currentRepo?.path === path ? { ...currentRepo, ...settings } : currentRepo
    set({ repos: newRepos, currentRepo: newCurrent, successMessage: '设置已保存' })
    await persistConfig(newRepos, newCurrent?.path || null)
    setTimeout(() => set({ successMessage: null }), 2000)
  },

  // ── Git 操作 ─────────────────────────────────────────────

  refreshStatus: async () => {
    try {
      const response = await window.electronAPI.invokeGit('staging.status')
      if (response.success) {
        set({ fileStatuses: (response.data as FileStatusInfo[]) || [] })
      }
    } catch (err) {
      console.error('[AppStore] refreshStatus 失败:', err)
    }
  },

  refreshHistory: async () => {
    try {
      const response = await window.electronAPI.invokeGit('commit.log', { max: 50 })
      if (response.success) {
        set({ commitHistory: (response.data as CommitRecord[]) || [] })
      }
    } catch (err) {
      console.error('[AppStore] refreshHistory 失败:', err)
    }
  },

  refreshBranches: async () => {
    try {
      const { currentRepo } = get()
      if (currentRepo) {
        await window.electronAPI.invokeGit('remote.fetch', remotePayload(currentRepo))
      }

      const [branchRes, currentRes] = await Promise.all([
        window.electronAPI.invokeGit('branch.list'),
        window.electronAPI.invokeGit('branch.current')
      ])
      if (branchRes.success) {
        set({ branches: (branchRes.data as BranchInfo[]) || [] })
      }
      if (currentRes.success && currentRes.data) {
        const data = currentRes.data as { branch: string }
        set({ currentBranch: data.branch })
        
        const abRes = await window.electronAPI.invokeGit('branch.aheadBehind', { branch: data.branch })
        if (abRes.success && abRes.data) {
          const ab = abRes.data as { ahead: number, behind: number }
          set({ commitsAhead: ab.ahead, commitsBehind: ab.behind })
        } else {
          set({ commitsAhead: 0, commitsBehind: 0 })
        }
      }
    } catch (err) {
      console.error('[AppStore] refreshBranches 失败:', err)
    }
  },

  refreshAll: async () => {
    set({ loading: true })
    const state = get()
    await Promise.all([state.refreshStatus(), state.refreshHistory(), state.refreshBranches()])
    set({ loading: false })
  },

  addFile: async (path: string) => {
    set({ operationLoading: 'add' })
    try {
      const response = await window.electronAPI.invokeGit('staging.add', { path })
      if (!response.success) {
        set({ error: `Add 失败: ${response.error}`, operationLoading: null })
        return
      }
      await get().refreshStatus()
    } catch (err) {
      set({ error: `Add 失败: ${err}` })
    }
    set({ operationLoading: null })
  },

  addAll: async () => {
    set({ operationLoading: 'addAll' })
    try {
      const response = await window.electronAPI.invokeGit('staging.addAll')
      if (!response.success) {
        set({ error: `Add All 失败: ${response.error}`, operationLoading: null })
        return
      }
      await get().refreshStatus()
    } catch (err) {
      set({ error: `Add All 失败: ${err}` })
    }
    set({ operationLoading: null })
  },

  removeFile: async (path: string) => {
    set({ operationLoading: 'remove' })
    try {
      const response = await window.electronAPI.invokeGit('staging.remove', { path })
      if (!response.success) {
        set({ error: `Remove 失败: ${response.error}`, operationLoading: null })
        return
      }
      await get().refreshStatus()
    } catch (err) {
      set({ error: `Remove 失败: ${err}` })
    }
    set({ operationLoading: null })
  },

  createCommit: async (message: string) => {
    set({ operationLoading: 'commit' })
    try {
      const { currentRepo } = get()
      const payload: Record<string, unknown> = { message }
      const authorEmail = cleanSetting(currentRepo?.commitAuthorEmail)
      const authorName = cleanSetting(currentRepo?.commitAuthorName) || (authorEmail ? cleanSetting(currentRepo?.authUsername) : undefined)
      if (authorName) payload.authorName = authorName
      if (authorEmail) payload.authorEmail = authorEmail

      const response = await window.electronAPI.invokeGit('commit.create', payload)
      if (!response.success) {
        set({ error: `Commit 失败: ${response.error}`, operationLoading: null })
        return
      }
      set({ successMessage: `提交成功` })
      await get().refreshAll()
      setTimeout(() => set({ successMessage: null }), 3000)
    } catch (err) {
      set({ error: `Commit 失败: ${err}` })
    }
    set({ operationLoading: null })
  },

  push: async () => {
    set({ operationLoading: 'push' })
    try {
      const { currentRepo } = get()
      const payload = remotePayload(currentRepo)

      const response = await window.electronAPI.invokeGit('remote.push', payload)
      if (!response.success) {
        set({ error: `Push 失败: ${response.error}`, operationLoading: null })
        return
      }
      set({ successMessage: 'Push 成功' })
      await get().refreshAll()
      setTimeout(() => set({ successMessage: null }), 3000)
    } catch (err) {
      set({ error: `Push 失败: ${err}` })
    }
    set({ operationLoading: null })
  },

  pull: async () => {
    set({ operationLoading: 'pull' })
    try {
      const { currentRepo } = get()
      const payload = remotePayload(currentRepo)

      const response = await window.electronAPI.invokeGit('remote.pull', payload)
      if (!response.success) {
        set({ error: `Pull 失败: ${response.error}`, operationLoading: null })
        return
      }
      set({ successMessage: 'Pull 成功' })
      await get().refreshAll()
      setTimeout(() => set({ successMessage: null }), 3000)
    } catch (err) {
      set({ error: `Pull 失败: ${err}` })
    }
    set({ operationLoading: null })
  },

  checkoutBranch: async (branch: string) => {
    set({ operationLoading: 'checkout' })
    try {
      const response = await window.electronAPI.invokeGit('branch.checkout', { branch })
      if (!response.success) {
        set({ error: `切换分支失败: ${response.error}`, operationLoading: null })
        return
      }
      set({ successMessage: `已切换到分支 ${branch}` })
      await get().refreshAll()
      setTimeout(() => set({ successMessage: null }), 3000)
    } catch (err) {
      set({ error: `切换分支失败: ${err}` })
    }
    set({ operationLoading: null })
  },

  // ── UI 操作 ──────────────────────────────────────────────

  setActiveView: (view) => set({ activeView: view }),
  clearError: () => set({ error: null }),
  clearSuccess: () => set({ successMessage: null })
}))
