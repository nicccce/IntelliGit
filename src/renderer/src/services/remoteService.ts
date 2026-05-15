import type { RepoConfig } from '../../../shared/types'
import type { RemoteInfo, RemoteOperationPayload } from '../../../shared/types'
import { invokeGit } from '../api/gitClient'

export function inferRemoteType(url: string): 'none' | 'http' | 'ssh' {
  if (!url) return 'none'
  const lower = url.trim().toLowerCase()
  if (lower.startsWith('http://') || lower.startsWith('https://')) return 'http'
  if (lower.startsWith('git@') || lower.startsWith('ssh://')) return 'ssh'
  return 'none'
}

export async function detectAndSyncRemote(
  storedRepo: RepoConfig | undefined
): Promise<Partial<RepoConfig> | null> {
  try {
    const remotes = await invokeGit('remote.list')
    const origin = (remotes as RemoteInfo[]).find((remote) => remote.name === 'origin')

    if (!origin || !origin.fetchUrl) {
      if (storedRepo?.remoteType && storedRepo.remoteType !== 'none') {
        return {
          remoteType: 'none',
          httpRemoteUrl: undefined,
          sshRemoteUrl: undefined,
          authUsername: undefined,
          authPassword: undefined,
          sshKeyPath: undefined,
          sshPassword: undefined
        }
      }
      return null
    }

    const inferredType = inferRemoteType(origin.fetchUrl)
    const storedUrl = inferredType === 'http' ? storedRepo?.httpRemoteUrl : storedRepo?.sshRemoteUrl
    const urlChanged = storedUrl !== origin.fetchUrl

    if (urlChanged || !storedRepo?.remoteType || storedRepo.remoteType === 'none') {
      const patch: Partial<RepoConfig> = { remoteType: inferredType }
      if (inferredType === 'http') {
        patch.httpRemoteUrl = origin.fetchUrl
        patch.authUsername = undefined
        patch.authPassword = undefined
      } else if (inferredType === 'ssh') {
        patch.sshRemoteUrl = origin.fetchUrl
        patch.sshKeyPath = undefined
        patch.sshPassword = undefined
      }
      return patch
    }

    return null
  } catch {
    console.warn('[remoteService] 远程检测失败')
    return null
  }
}

export function buildRemotePayload(repo: RepoConfig | null): RemoteOperationPayload {
  const payload: RemoteOperationPayload = { remote: 'origin' }
  if (!repo || !repo.remoteType || repo.remoteType === 'none') return payload

  if (repo.remoteType === 'http') {
    if (repo.httpRemoteUrl) payload.url = repo.httpRemoteUrl
    if (repo.authUsername) payload.username = repo.authUsername
    if (repo.authPassword) payload.password = repo.authPassword
    return payload
  }

  if (repo.remoteType === 'ssh') {
    if (repo.sshRemoteUrl) payload.url = repo.sshRemoteUrl
    if (repo.sshKeyPath) payload.sshKeyPath = repo.sshKeyPath
    if (repo.sshPassword) payload.sshPassword = repo.sshPassword
    return payload
  }

  return payload
}
