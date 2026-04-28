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
    /** 分支列表（本地分支） */
  branches: BranchInfo[]
  /** 远程跟踪分支列表（origin/*） */
  remoteBranches: BranchInfo[]
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
  addRepo: (path: string) => Promise<{ success: boolean; error?: string }>
  /** 新建仓库 */
  createRepo: (path: string) => Promise<{ success: boolean; error?: string }>
  /** 克隆远程仓库 */
  cloneRepo: (url: string, path: string) => Promise<{ success: boolean; error?: string }>
  /** 移除仓库 */
  removeRepo: (path: string) => Promise<void>
  /** 切换当前仓库 */
  switchRepo: (path: string) => Promise<void>
  /** 更新仓库设置 */
  updateRepoSettings: (path: string, settings: Partial<RepoConfig>) => Promise<void>

  // ── Git 操作 ─────────────────────────────────────────────
    /** 刷新本地全部状态（文件状态、历史、分支列表、当前分支、ahead/behind，不含远程 fetch） */
    refreshAllLocal: () => Promise<void>
    /** 刷新远程仓库状态（git fetch + 刷新分支列表与 ahead/behind） */
    refreshRemote: () => Promise<void>
    /** 刷新仓库状态（仅文件变更状态） */
    refreshStatus: () => Promise<void>
    /** 刷新提交历史 */
    refreshHistory: () => Promise<void>
    /** 全量主动刷新（fetch + 本地状态 + 历史） */
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

/** 根据远程 URL 推断远程类型 */
function inferRemoteType(url: string): 'none' | 'http' | 'ssh' {
  if (!url) return 'none'
  const lower = url.trim().toLowerCase()
  if (lower.startsWith('http://') || lower.startsWith('https://')) return 'http'
  if (lower.startsWith('git@') || lower.startsWith('ssh://')) return 'ssh'
  return 'none'
}

interface RemoteInfo {
  name: string
  fetchUrl: string
  pushUrls: string[]
}

/**
 * 检测远程仓库实际配置，并与存储配置比对。
 * 若 remoteUrl 未变化则保留原有认证，否则清空认证。
 */
async function detectAndSyncRemote(
  path: string,
  storedRepo: RepoConfig | undefined
): Promise<Partial<RepoConfig> | null> {
  try {
    const response = await window.electronAPI.invokeGit('remote.list')
    if (!response.success || !response.data) return null

    const remotes = response.data as RemoteInfo[]
    const origin = remotes.find((r) => r.name === 'origin')

    if (!origin || !origin.fetchUrl) {
      // 仓库没有配置 origin 远程
      if (storedRepo?.remoteType && storedRepo.remoteType !== 'none') {
        // 之前有远程配置但现在仓库里没有了，重置为 none
        return { remoteType: 'none' as const, remoteUrl: undefined,
          authUsername: undefined, authPassword: undefined,
          sshKeyPath: undefined, sshPassword: undefined }
      }
      return null
    }

    const inferredType = inferRemoteType(origin.fetchUrl)

    // 判断远程地址是否与存储的一致
    const urlChanged = storedRepo?.remoteUrl !== origin.fetchUrl

    if (urlChanged || !storedRepo?.remoteType || storedRepo.remoteType === 'none') {
      // 地址变了（或之前没有配置）→ 使用新地址并清空认证
      return {
        remoteType: inferredType,
        remoteUrl: origin.fetchUrl,
        authUsername: undefined,
        authPassword: undefined,
        sshKeyPath: undefined,
        sshPassword: undefined
      }
    }

    // 地址未变 → 保持原认证
    return null
  } catch {
    console.warn('[detectAndSyncRemote] 远程检测失败')
    return null
  }
}

function remotePayload(repo: RepoConfig | null): Record<string, unknown> {
  const payload: Record<string, unknown> = { remote: 'origin' }
  if (!repo || !repo.remoteType || repo.remoteType === 'none') return payload

  if (repo.remoteUrl) payload.url = repo.remoteUrl

  if (repo.remoteType === 'http') {
    if (repo?.authUsername) payload.username = repo.authUsername
    if (repo?.authPassword) payload.password = repo.authPassword
    return payload
  }

  if (repo.remoteType === 'ssh') {
    if (repo?.sshKeyPath) payload.sshKeyPath = repo.sshKeyPath
    if (repo?.sshPassword) payload.sshPassword = repo.sshPassword
    return payload
  }

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
  remoteBranches: [],
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
      let repo = config.currentRepoPath
        ? config.repos.find((r) => r.path === config.currentRepoPath) || null
        : null
      const repos = config.repos

      // 预先打开仓库并检测远程，避免 UI 先显示旧值再跳变
      if (repo) {
        try {
          await window.electronAPI.invokeGit('repo.open', { path: repo.path })
          const remotePatch = await detectAndSyncRemote(repo.path, repo)
          if (remotePatch) {
            repo = { ...repo, ...remotePatch }
            // 更新 repos 列表中的对应项
            const idx = repos.findIndex((r) => r.path === repo!.path)
            if (idx !== -1) repos[idx] = repo
            // 持久化更新后的配置
            await persistConfig(repos, repo.path)
          }
        } catch {
          console.warn('[AppStore] 打开仓库失败，可能路径无效')
        }
      }

      set({ repos: [...repos], currentRepo: repo, configLoaded: true })

      // 刷新
      if (repo) {
        const state = get()
        await state.refreshAll()
      }
    } catch (err) {
      console.error('[AppStore] 加载配置失败:', err)
      set({ configLoaded: true })
    }
  },

        addRepo: async (path: string) => {
    const { repos } = get()
    if (repos.find((r) => r.path === path)) {
      return { success: false, error: '该仓库已存在' }
    }

    // 尝试打开仓库验证
    const response = await window.electronAPI.invokeGit('repo.open', { path })
    if (!response.success) {
      return { success: false, error: `无法打开仓库: ${response.error}` }
    }

    // 先检测远程再更新 state，避免 UI 先显示旧值再跳变
    let newRepo: RepoConfig = { path, name: repoNameFromPath(path) }
    const remotePatch = await detectAndSyncRemote(path, newRepo)
    if (remotePatch) {
      newRepo = { ...newRepo, ...remotePatch }
    }

    const newRepos = [...repos, newRepo]
    set({ repos: newRepos, currentRepo: newRepo, error: null })
    await persistConfig(newRepos, path)

    // 刷新
    const state = get()
    await state.refreshAll()
    return { success: true }
  },

  createRepo: async (path: string) => {
    const { repos } = get()
    if (repos.find((r) => r.path === path)) {
      return { success: false, error: '该仓库已存在' }
    }

    const response = await window.electronAPI.invokeGit('repo.init', { path, bare: false })
    if (!response.success) {
      return { success: false, error: `创建仓库失败: ${response.error}` }
    }

    return await get().addRepo(path)
  },

  cloneRepo: async (url: string, path: string) => {
    const { repos } = get()
    if (repos.find((r) => r.path === path)) {
      return { success: false, error: '该仓库已存在' }
    }

    const response = await window.electronAPI.invokeGit('repo.clone', { url, path })
    if (!response.success) {
      return { success: false, error: `克隆仓库失败: ${response.error}` }
    }

    return await get().addRepo(path)
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
      branches: newCurrent ? get().branches : [],
      remoteBranches: newCurrent ? get().remoteBranches : []
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

      // 先检测远程再更新 state，避免 UI 先显示旧值再跳变
      const remotePatch = await detectAndSyncRemote(path, repo)
      let newRepos = repos
      let updatedRepo = repo
      if (remotePatch) {
        updatedRepo = { ...repo, ...remotePatch }
        newRepos = repos.map((r) => (r.path === path ? updatedRepo : r))
        await persistConfig(newRepos, path)
      } else {
        await persistConfig(repos, path)
      }
      set({ currentRepo: updatedRepo, repos: newRepos })

            // 先同步刷新本地状态确保 UI 及时响应
            const state = get()
            await state.refreshAllLocal()
            set({ loading: false })
            // 异步获取远程状态（不阻塞 UI）
            state.refreshRemote().catch(err =>
              console.error('[AppStore] switchRepo 异步远程刷新失败:', err)
            )
    } catch (err) {
            set({ error: `切换仓库失败: ${err}`, loading: false })
    }
  },

    updateRepoSettings: async (path: string, settings: Partial<RepoConfig>) => {
    const { repos, currentRepo } = get()
    const oldRepo = repos.find((r) => r.path === path)
    const newRepos = repos.map((r) => (r.path === path ? { ...r, ...settings } : r))
    const newCurrent = currentRepo?.path === path ? { ...currentRepo, ...settings } : currentRepo
    set({ repos: newRepos, currentRepo: newCurrent, successMessage: '设置已保存' })
    await persistConfig(newRepos, newCurrent?.path || null)

    // 同步远程仓库地址到 Git 仓库
    try {
      if (settings.remoteType === 'none' && oldRepo?.remoteUrl) {
        // 用户选择了"无"，删除 origin 远程
        await window.electronAPI.invokeGit('remote.remove', { name: 'origin' })
      } else if (settings.remoteUrl !== undefined && settings.remoteUrl) {
        // 远程地址被设置或修改，同步到 Git
        await window.electronAPI.invokeGit('remote.setUrl', { name: 'origin', url: settings.remoteUrl })
      }
    } catch (err) {
      console.warn('[AppStore] 同步远程地址到 Git 失败:', err)
    }

    setTimeout(() => set({ successMessage: null }), 2000)
  },

  // ── Git 操作 ─────────────────────────────────────────────

    /** 刷新本地全部状态（文件状态、历史、分支、ahead/behind，不含远程 fetch） */
    refreshAllLocal: async () => {
      try {
        const state = get()
        await Promise.all([
          state.refreshStatus(),
          state.refreshHistory(),
          (async () => {
            try {
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
                  const ab = abRes.data as { ahead: number; behind: number }
                  set({ commitsAhead: ab.ahead, commitsBehind: ab.behind })
                } else {
                  set({ commitsAhead: 0, commitsBehind: 0 })
                }
              }
            } catch (err) {
              console.error('[AppStore] refreshAllLocal 本地分支刷新失败:', err)
            }
          })()
        ])
      } catch (err) {
        console.error('[AppStore] refreshAllLocal 失败:', err)
      }
    },

        /** 刷新远程仓库状态（git fetch + 获取远程跟踪分支 + 刷新分支列表与 ahead/behind） */
    refreshRemote: async () => {
      try {
        const { currentRepo } = get()
        if (currentRepo) {
          await window.electronAPI.invokeGit('remote.fetch', remotePayload(currentRepo))
        }

        const [branchRes, remoteBranchRes, currentRes] = await Promise.all([
          window.electronAPI.invokeGit('branch.list'),
          window.electronAPI.invokeGit('branch.listRemote'),
          window.electronAPI.invokeGit('branch.current')
        ])
        if (branchRes.success) {
          set({ branches: (branchRes.data as BranchInfo[]) || [] })
        }
                if (remoteBranchRes.success) {
          const rawRemoteBranches = (remoteBranchRes.data as BranchInfo[]) || []
          // 过滤掉 origin/HEAD 等远程 HEAD 符号引用
          set({ remoteBranches: rawRemoteBranches.filter(rb => rb.name !== 'HEAD' && !rb.name.endsWith('/HEAD')) })
        }
        if (currentRes.success && currentRes.data) {
          const data = currentRes.data as { branch: string }
          set({ currentBranch: data.branch })

          const abRes = await window.electronAPI.invokeGit('branch.aheadBehind', { branch: data.branch })
          if (abRes.success && abRes.data) {
            const ab = abRes.data as { ahead: number; behind: number }
            set({ commitsAhead: ab.ahead, commitsBehind: ab.behind })
          } else {
            set({ commitsAhead: 0, commitsBehind: 0 })
          }
        }
      } catch (err) {
        console.error('[AppStore] refreshRemote 失败:', err)
      }
    },

    /** 刷新仓库状态（仅文件变更状态） */
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

    /** 刷新提交历史 */
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

    /** 主动全量刷新（fetch + 本地状态 + 历史） */
    refreshAll: async () => {
      set({ loading: true })
      const state = get()
      // 主动刷新：优先获取远程状态（fetch + 分支），同时并行拉取本地状态和历史
      await Promise.all([
        state.refreshRemote(),
        state.refreshStatus(),
        state.refreshHistory()
      ])
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
      const { branches, remoteBranches } = get()
      const isLocalBranch = branches.some(b => b.name === branch)

      if (isLocalBranch) {
        // 本地已存在分支：直接切换
        const response = await window.electronAPI.invokeGit('branch.checkout', { branch })
        if (!response.success) {
          set({ error: `切换分支失败: ${response.error}`, operationLoading: null })
          return
        }
        set({ successMessage: `已切换到分支 ${branch}` })
      } else {
        // 本地不存在 → 尝试从远程跟踪分支创建并切换
        const remoteRefName = `origin/${branch}`
        const remoteBranch = remoteBranches.find(rb => rb.name === remoteRefName)
        if (!remoteBranch) {
          set({ error: `本地不存在分支 ${branch}，且远程也无对应跟踪分支`, operationLoading: null })
          return
        }
        const response = await window.electronAPI.invokeGit('branch.checkoutNew', {
          branch,
          startFrom: remoteBranch.hash
        })
        if (!response.success) {
          set({ error: `创建并切换分支失败: ${response.error}`, operationLoading: null })
          return
        }
        set({ successMessage: `已创建并切换到分支 ${branch}` })
      }

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
