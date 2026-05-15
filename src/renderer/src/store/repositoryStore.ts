import { create } from 'zustand'

import type { RepoConfig } from '../../../shared/types'
import {
  addExistingRepository,
  cloneRepository,
  createRepository,
  loadRepositoryConfig,
  persistConfig,
  switchRepository,
  updateRepositorySettings as saveRepositorySettings,
  type RepositoryActionResult
} from '../services/repositoryService'
import { withOperation } from './operationStore'
import { useUiStore } from './uiStore'

interface RepositoryStoreState {
  repos: RepoConfig[]
  currentRepo: RepoConfig | null
  configLoaded: boolean
  loadConfig: () => Promise<void>
  addRepo: (path: string) => Promise<RepositoryActionResult>
  createRepo: (path: string) => Promise<RepositoryActionResult>
  cloneRepo: (url: string, path: string) => Promise<RepositoryActionResult>
  removeRepo: (path: string) => Promise<void>
  switchRepo: (path: string) => Promise<void>
  updateRepoSettings: (path: string, settings: Partial<RepoConfig>) => Promise<void>
}

export const useRepositoryStore = create<RepositoryStoreState>((set, get) => ({
  repos: [],
  currentRepo: null,
  configLoaded: false,

  loadConfig: async () => {
    try {
      await withOperation('repo.load', async () => {
        const { repos, currentRepo } = await loadRepositoryConfig()
        set({ repos, currentRepo, configLoaded: true })

        if (currentRepo) {
          const { refreshAll } = await import('../services/refreshCoordinator')
          await refreshAll()
        }
      })
    } catch (err) {
      console.error('[RepositoryStore] 加载配置失败:', err)
      set({ configLoaded: true })
    }
  },

  addRepo: async (path) => {
    const { repos } = get()
    return withOperation('repo.add', async () => {
      const result = await addExistingRepository(path, repos)
      if (!result.success || !result.currentRepo) return result

      set({ repos: result.repos, currentRepo: result.currentRepo })
      useUiStore.getState().setError(null)

      const { refreshAll } = await import('../services/refreshCoordinator')
      await refreshAll()
      return { success: true }
    })
  },

  createRepo: async (path) => {
    const { repos } = get()
    return withOperation('repo.create', async () => {
      const result = await createRepository(path, repos)
      if (!result.success || !result.currentRepo) return result

      set({ repos: result.repos, currentRepo: result.currentRepo })

      const { refreshAll } = await import('../services/refreshCoordinator')
      await refreshAll()
      return { success: true }
    })
  },

  cloneRepo: async (url, path) => {
    const { repos } = get()
    return withOperation('repo.clone', async () => {
      const result = await cloneRepository(url, path, repos)
      if (!result.success || !result.currentRepo) return result

      set({ repos: result.repos, currentRepo: result.currentRepo })

      const { refreshAll } = await import('../services/refreshCoordinator')
      await refreshAll()
      return { success: true }
    })
  },

  removeRepo: async (path) => {
    const { repos, currentRepo } = get()
    const newRepos = repos.filter((repo) => repo.path !== path)
    const newCurrent = currentRepo?.path === path ? null : currentRepo

    set({ repos: newRepos, currentRepo: newCurrent })
    await persistConfig(newRepos, newCurrent?.path || null)

    if (currentRepo?.path === path) {
      const { clearRepositoryScopedState } = await import('../services/refreshCoordinator')
      clearRepositoryScopedState()
    }

    useUiStore.getState().setError(null)
    useUiStore.getState().clearSuccess()
  },

  switchRepo: async (path) => {
    const { repos } = get()
    useUiStore.getState().setLoading(true)
    useUiStore.getState().setError(null)

    try {
      await withOperation('repo.switch', async () => {
        const result = await switchRepository(path, repos)
        if (!result.success || !result.currentRepo) {
          useUiStore.getState().setError(result.error || '切换仓库失败')
          return
        }

        set({ repos: result.repos, currentRepo: result.currentRepo })

        const { clearRepositoryScopedState, refreshAllLocal, refreshRemote } =
          await import('../services/refreshCoordinator')
        clearRepositoryScopedState()
        await refreshAllLocal()
        refreshRemote().catch((err) =>
          console.error('[RepositoryStore] switchRepo 异步远程刷新失败:', err)
        )
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useUiStore.getState().setError(`切换仓库失败: ${message}`)
    } finally {
      useUiStore.getState().setLoading(false)
    }
  },

  updateRepoSettings: async (path, settings) => {
    const { repos, currentRepo } = get()
    await withOperation('repo.settings', async () => {
      const result = await saveRepositorySettings(path, settings, repos, currentRepo)
      set({ repos: result.repos, currentRepo: result.currentRepo })
      useUiStore.getState().showSuccess('设置已保存', 2000)
    })
  }
}))
