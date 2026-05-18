import type { AppConfig, LlmConfig, RepoConfig } from '../../../shared/types'
import { loadConfig, saveConfig } from '../api/configClient'
import { canInvokeGit, invokeGit } from '../api/gitClient'
import { detectAndSyncRemote } from './remoteService'

export interface RepositoryActionResult {
  success: boolean
  error?: string
}

export interface RepositoryConfigSnapshot {
  repos: RepoConfig[]
  currentRepo: RepoConfig | null
  llmConfig?: LlmConfig
}

export function repoNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || path
}

export async function persistConfig(
  repos: RepoConfig[],
  currentRepoPath: string | null
): Promise<void> {
  // 读取当前完整配置以保留 llmConfig 字段
  const current = await loadConfig()
  const config: AppConfig = { ...current, repos, currentRepoPath }
  await saveConfig(config)
}

export async function loadRepositoryConfig(): Promise<RepositoryConfigSnapshot> {
  const config = await loadConfig()
  const repos = [...config.repos]
  let currentRepo = config.currentRepoPath
    ? repos.find((repo) => repo.path === config.currentRepoPath) || null
    : null

  if (currentRepo) {
    try {
      await invokeGit('repo.open', { path: currentRepo.path })
      const remotePatch = await detectAndSyncRemote(currentRepo)
      if (remotePatch) {
        currentRepo = { ...currentRepo, ...remotePatch }
        const repoIndex = repos.findIndex((repo) => repo.path === currentRepo!.path)
        if (repoIndex !== -1) repos[repoIndex] = currentRepo
        await persistConfig(repos, currentRepo.path)
      }
    } catch {
      console.warn('[repositoryService] 打开仓库失败，可能路径无效')
    }
  }

  return { repos, currentRepo, llmConfig: config.llmConfig }
}

export async function isGitRepository(path: string): Promise<boolean> {
  return canInvokeGit('repo.open', { path })
}

export async function addExistingRepository(
  path: string,
  repos: RepoConfig[]
): Promise<RepositoryActionResult & RepositoryConfigSnapshot> {
  if (repos.find((repo) => repo.path === path)) {
    return { success: false, error: '该仓库已存在', repos, currentRepo: null }
  }

  try {
    await invokeGit('repo.open', { path })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `无法打开仓库: ${message}`, repos, currentRepo: null }
  }

  let newRepo: RepoConfig = { path, name: repoNameFromPath(path) }
  const remotePatch = await detectAndSyncRemote(newRepo)
  if (remotePatch) {
    newRepo = { ...newRepo, ...remotePatch }
  }

  const newRepos = [...repos, newRepo]
  await persistConfig(newRepos, path)
  return { success: true, repos: newRepos, currentRepo: newRepo }
}

export async function createRepository(
  path: string,
  repos: RepoConfig[]
): Promise<RepositoryActionResult & RepositoryConfigSnapshot> {
  if (repos.find((repo) => repo.path === path)) {
    return { success: false, error: '该仓库已存在', repos, currentRepo: null }
  }

  try {
    await invokeGit('repo.init', { path, bare: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `创建仓库失败: ${message}`, repos, currentRepo: null }
  }

  return addExistingRepository(path, repos)
}

export async function cloneRepository(
  url: string,
  path: string,
  repos: RepoConfig[]
): Promise<RepositoryActionResult & RepositoryConfigSnapshot> {
  if (repos.find((repo) => repo.path === path)) {
    return { success: false, error: '该仓库已存在', repos, currentRepo: null }
  }

  try {
    await invokeGit('repo.clone', { url, path })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `克隆仓库失败: ${message}`, repos, currentRepo: null }
  }

  return addExistingRepository(path, repos)
}

export async function switchRepository(
  path: string,
  repos: RepoConfig[]
): Promise<RepositoryActionResult & RepositoryConfigSnapshot> {
  const repo = repos.find((item) => item.path === path)
  if (!repo) {
    return { success: false, error: '仓库不存在', repos, currentRepo: null }
  }

  try {
    await invokeGit('repo.open', { path })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: `切换仓库失败: ${message}`, repos, currentRepo: null }
  }

  const remotePatch = await detectAndSyncRemote(repo)
  let newRepos = repos
  let currentRepo = repo

  if (remotePatch) {
    currentRepo = { ...repo, ...remotePatch }
    newRepos = repos.map((item) => (item.path === path ? currentRepo : item))
  }

  await persistConfig(newRepos, path)
  return { success: true, repos: newRepos, currentRepo }
}

export async function updateRepositorySettings(
  path: string,
  settings: Partial<RepoConfig>,
  repos: RepoConfig[],
  currentRepo: RepoConfig | null
): Promise<RepositoryConfigSnapshot> {
  const newRepos = repos.map((repo) => (repo.path === path ? { ...repo, ...settings } : repo))
  const newCurrent = currentRepo?.path === path ? { ...currentRepo, ...settings } : currentRepo
  await persistConfig(newRepos, newCurrent?.path || null)

  try {
    if (settings.remoteType === 'none') {
      await invokeGit('remote.remove', { name: 'origin' })
    } else if (settings.remoteType === 'http' && settings.httpRemoteUrl) {
      await invokeGit('remote.setUrl', { name: 'origin', url: settings.httpRemoteUrl })
    } else if (settings.remoteType === 'ssh' && settings.sshRemoteUrl) {
      await invokeGit('remote.setUrl', { name: 'origin', url: settings.sshRemoteUrl })
    }
  } catch (err) {
    console.warn('[repositoryService] 同步远程地址到 Git 失败:', err)
  }

  return { repos: newRepos, currentRepo: newCurrent }
}
