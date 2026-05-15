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
} from './repositoryService'
import { withOperation } from '../store/operationStore'
import { useRepositoryStore, type RepositoryStateData } from '../store/repositoryStore'
import { useUiStore } from '../store/uiStore'
import {
  clearRepositoryScopedState,
  refreshAll,
  refreshAllLocal,
  refreshRemote
} from './refreshCoordinator'

function setRepositoryState(state: Partial<RepositoryStateData>): void {
  useRepositoryStore.getState().setRepositoryState(state)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function loadConfig(): Promise<void> {
  try {
    await withOperation('repo.load', async () => {
      const { repos, currentRepo } = await loadRepositoryConfig()
      setRepositoryState({ repos, currentRepo, configLoaded: true })

      if (currentRepo) {
        await refreshAll()
      }
    })
  } catch (err) {
    console.error('[repositoryWorkflowService] 加载配置失败:', err)
    setRepositoryState({ configLoaded: true })
  }
}

export async function addRepo(path: string): Promise<RepositoryActionResult> {
  const { repos } = useRepositoryStore.getState()
  return withOperation('repo.add', async () => {
    const result = await addExistingRepository(path, repos)
    if (!result.success || !result.currentRepo) return result

    setRepositoryState({ repos: result.repos, currentRepo: result.currentRepo })
    useUiStore.getState().setError(null)
    await refreshAll()
    return { success: true }
  })
}

export async function createRepo(path: string): Promise<RepositoryActionResult> {
  const { repos } = useRepositoryStore.getState()
  return withOperation('repo.create', async () => {
    const result = await createRepository(path, repos)
    if (!result.success || !result.currentRepo) return result

    setRepositoryState({ repos: result.repos, currentRepo: result.currentRepo })
    await refreshAll()
    return { success: true }
  })
}

export async function cloneRepo(url: string, path: string): Promise<RepositoryActionResult> {
  const { repos } = useRepositoryStore.getState()
  return withOperation('repo.clone', async () => {
    const result = await cloneRepository(url, path, repos)
    if (!result.success || !result.currentRepo) return result

    setRepositoryState({ repos: result.repos, currentRepo: result.currentRepo })
    await refreshAll()
    return { success: true }
  })
}

export async function removeRepo(path: string): Promise<void> {
  const { repos, currentRepo } = useRepositoryStore.getState()
  const newRepos = repos.filter((repo) => repo.path !== path)
  const newCurrent = currentRepo?.path === path ? null : currentRepo

  setRepositoryState({ repos: newRepos, currentRepo: newCurrent })
  await persistConfig(newRepos, newCurrent?.path || null)

  if (currentRepo?.path === path) {
    clearRepositoryScopedState()
  }

  useUiStore.getState().setError(null)
  useUiStore.getState().clearSuccess()
}

export async function switchRepo(path: string): Promise<void> {
  const { repos } = useRepositoryStore.getState()
  useUiStore.getState().setLoading(true)
  useUiStore.getState().setError(null)

  try {
    await withOperation('repo.switch', async () => {
      const result = await switchRepository(path, repos)
      if (!result.success || !result.currentRepo) {
        useUiStore.getState().setError(result.error || '切换仓库失败')
        return
      }

      setRepositoryState({ repos: result.repos, currentRepo: result.currentRepo })
      clearRepositoryScopedState()
      await refreshAllLocal()
      refreshRemote().catch((err) =>
        console.error('[repositoryWorkflowService] switchRepo 异步远程刷新失败:', err)
      )
    })
  } catch (err) {
    useUiStore.getState().setError(`切换仓库失败: ${errorMessage(err)}`)
  } finally {
    useUiStore.getState().setLoading(false)
  }
}

export async function updateRepoSettings(
  path: string,
  settings: Partial<RepoConfig>
): Promise<void> {
  const { repos, currentRepo } = useRepositoryStore.getState()
  await withOperation('repo.settings', async () => {
    const result = await saveRepositorySettings(path, settings, repos, currentRepo)
    setRepositoryState({ repos: result.repos, currentRepo: result.currentRepo })
    useUiStore.getState().showSuccess('设置已保存', 2000)
  })
}
