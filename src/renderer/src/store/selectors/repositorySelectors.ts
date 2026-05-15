import type { RepositoryStoreState } from '../repositoryStore'

export const selectRepos = (state: RepositoryStoreState): RepositoryStoreState['repos'] =>
  state.repos

export const selectCurrentRepo = (
  state: RepositoryStoreState
): RepositoryStoreState['currentRepo'] => state.currentRepo

export const selectCurrentRepoPath = (state: RepositoryStoreState): string | undefined =>
  state.currentRepo?.path

export const selectConfigLoaded = (state: RepositoryStoreState): boolean => state.configLoaded
