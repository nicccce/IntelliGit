import { create } from 'zustand'

import type { RepoConfig } from '../../../shared/types'

export interface RepositoryStoreState {
  repos: RepoConfig[]
  currentRepo: RepoConfig | null
  configLoaded: boolean
  setRepositoryState: (state: Partial<RepositoryStateData>) => void
}

export type RepositoryStateData = Pick<
  RepositoryStoreState,
  'repos' | 'currentRepo' | 'configLoaded'
>

export const useRepositoryStore = create<RepositoryStoreState>((set) => ({
  repos: [],
  currentRepo: null,
  configLoaded: false,

  setRepositoryState: (state) => set(state)
}))
