import type { RepoConfig } from '../../../shared/types'
import { selectCurrentRepo } from '../store/selectors'
import { useRepositoryStore } from '../store'
import { updateRepoSettings } from '../services/repositoryWorkflowService'

interface SettingsViewModel {
  currentRepo: RepoConfig | null
  updateRepoSettings: (path: string, settings: Partial<RepoConfig>) => Promise<void>
}

export function useSettingsViewModel(): SettingsViewModel {
  const currentRepo = useRepositoryStore(selectCurrentRepo)

  return {
    currentRepo,
    updateRepoSettings
  }
}
