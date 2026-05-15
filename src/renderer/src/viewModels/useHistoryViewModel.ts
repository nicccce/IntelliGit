import { useMemo } from 'react'

import type { BranchInfo, CommitRecord, DiffEntry, RepoConfig } from '../../../shared/types'
import {
  useGitStatusStore,
  useHistoryStore,
  useOperationStore,
  useRepositoryStore,
  type OperationKey
} from '../store'
import {
  selectAllCommitHistory,
  selectBranches,
  selectCurrentBranch,
  selectCurrentRepo,
  selectFetchAllHistory,
  selectOperationLoading,
  selectRemoteBranches,
  selectSelectedCommit,
  selectSelectedCommitFiles,
  selectSelectCommit
} from '../store/selectors'
import { buildCommitLaneMap } from '../utils/commitGraph'

interface HistoryViewModel {
  allCommitHistory: CommitRecord[]
  allBranches: BranchInfo[]
  currentBranch: string
  currentRepo: RepoConfig | null
  selectedCommit: CommitRecord | null
  selectedCommitFiles: DiffEntry[]
  selectCommit: (commit: CommitRecord | null) => Promise<void>
  fetchAllHistory: () => Promise<void>
  operationLoading: OperationKey | null
  laneMap: Map<string, number>
  isBusy: boolean
}

export function useHistoryViewModel(): HistoryViewModel {
  const allCommitHistory = useHistoryStore(selectAllCommitHistory)
  const branches = useGitStatusStore(selectBranches)
  const remoteBranches = useGitStatusStore(selectRemoteBranches)
  const currentBranch = useGitStatusStore(selectCurrentBranch)
  const currentRepo = useRepositoryStore(selectCurrentRepo)
  const selectedCommit = useHistoryStore(selectSelectedCommit)
  const selectedCommitFiles = useHistoryStore(selectSelectedCommitFiles)
  const selectCommit = useHistoryStore(selectSelectCommit)
  const fetchAllHistory = useHistoryStore(selectFetchAllHistory)
  const operationLoading = useOperationStore(selectOperationLoading)

  const allBranches = useMemo(() => [...branches, ...remoteBranches], [branches, remoteBranches])
  const laneMap = useMemo(() => buildCommitLaneMap(allCommitHistory), [allCommitHistory])

  return {
    allCommitHistory,
    allBranches,
    currentBranch,
    currentRepo,
    selectedCommit,
    selectedCommitFiles,
    selectCommit,
    fetchAllHistory,
    operationLoading,
    laneMap,
    isBusy: Boolean(operationLoading)
  }
}
