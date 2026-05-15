import { useMemo } from 'react'

import type { RepoConfig } from '../../../shared/types'
import {
  useGitStatusStore,
  useOperationStore,
  useRepositoryStore,
  type OperationKey
} from '../store'
import {
  selectBranches,
  selectCommitsAhead,
  selectCommitsBehind,
  selectCurrentBranch,
  selectCurrentRepo,
  selectOperationLoading,
  selectRemoteBranches
} from '../store/selectors'
import { buildBranchPickerOptions, type BranchPickerOption } from '../utils/branchOptions'

interface ToolbarModel {
  currentRepo: RepoConfig | null
  currentBranch: string
  branchOptions: BranchPickerOption[]
  operationLoading: OperationKey | null
  hasRemote: boolean
  hasCommitsToPush: boolean
  hasCommitsToPull: boolean
  commitsAhead: number
  commitsBehind: number
  isBusy: boolean
}

export function useToolbarModel(): ToolbarModel {
  const currentRepo = useRepositoryStore(selectCurrentRepo)
  const currentBranch = useGitStatusStore(selectCurrentBranch)
  const branches = useGitStatusStore(selectBranches)
  const remoteBranches = useGitStatusStore(selectRemoteBranches)
  const operationLoading = useOperationStore(selectOperationLoading)
  const commitsAhead = useGitStatusStore(selectCommitsAhead)
  const commitsBehind = useGitStatusStore(selectCommitsBehind)

  const branchOptions = useMemo(
    () => buildBranchPickerOptions(branches, remoteBranches),
    [branches, remoteBranches]
  )
  const hasRemote = Boolean(currentRepo?.remoteType && currentRepo.remoteType !== 'none')
  const hasCommitsToPush = hasRemote && commitsAhead > 0 && commitsBehind === 0
  const hasCommitsToPull = hasRemote && commitsBehind > 0

  return {
    currentRepo,
    currentBranch,
    branchOptions,
    operationLoading,
    hasRemote,
    hasCommitsToPush,
    hasCommitsToPull,
    commitsAhead,
    commitsBehind,
    isBusy: Boolean(operationLoading)
  }
}
