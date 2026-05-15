import type { RepoConfig } from '../../../shared/types'
import type { RepositoryActionResult } from '../services/repositoryService'
import { selectCurrentRepo, selectRepos } from '../store/selectors'
import { useRepositoryStore } from '../store'
import {
  addRepo,
  cloneRepo,
  createRepo,
  removeRepo,
  switchRepo
} from '../services/repositoryWorkflowService'

interface RepoPanelModel {
  repos: RepoConfig[]
  currentRepo: RepoConfig | null
  switchRepo: (path: string) => Promise<void>
  addRepo: (path: string) => Promise<RepositoryActionResult>
  createRepo: (path: string) => Promise<RepositoryActionResult>
  cloneRepo: (url: string, path: string) => Promise<RepositoryActionResult>
  removeRepo: (path: string) => Promise<void>
}

export function useRepoPanelModel(): RepoPanelModel {
  const repos = useRepositoryStore(selectRepos)
  const currentRepo = useRepositoryStore(selectCurrentRepo)

  return {
    repos,
    currentRepo,
    switchRepo,
    addRepo,
    createRepo,
    cloneRepo,
    removeRepo
  }
}
