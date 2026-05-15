import type { RepoConfig } from '../../../shared/types'

import {
  selectCommitsAhead,
  selectCommitsBehind,
  selectCurrentBranch,
  selectCurrentRepo,
  selectOperationLabel
} from '../store/selectors'
import { useGitStatusStore, useOperationStore, useRepositoryStore } from '../store'

interface StatusBarModel {
  currentRepo: RepoConfig | null
  currentBranch: string
  commitsAhead: number
  commitsBehind: number
  operationLabel: string | null
}

export function useStatusBarModel(): StatusBarModel {
  const currentRepo = useRepositoryStore(selectCurrentRepo)
  const currentBranch = useGitStatusStore(selectCurrentBranch)
  const commitsAhead = useGitStatusStore(selectCommitsAhead)
  const commitsBehind = useGitStatusStore(selectCommitsBehind)
  const operationLabel = useOperationStore(selectOperationLabel)

  return {
    currentRepo,
    currentBranch,
    commitsAhead,
    commitsBehind,
    operationLabel
  }
}
