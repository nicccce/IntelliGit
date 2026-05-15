import type { BranchInfo } from '../../../../shared/types'
import type { GitStatusStoreState } from '../gitStatusStore'
import { countChangedFiles } from '../../utils/fileStatus'

export const selectFileStatuses = (
  state: GitStatusStoreState
): GitStatusStoreState['fileStatuses'] => state.fileStatuses

export const selectChangeCount = (state: GitStatusStoreState): number =>
  countChangedFiles(state.fileStatuses)

export const selectCurrentBranch = (state: GitStatusStoreState): string => state.currentBranch

export const selectBranches = (state: GitStatusStoreState): BranchInfo[] => state.branches

export const selectRemoteBranches = (state: GitStatusStoreState): BranchInfo[] =>
  state.remoteBranches

export const selectCommitsAhead = (state: GitStatusStoreState): number => state.commitsAhead

export const selectCommitsBehind = (state: GitStatusStoreState): number => state.commitsBehind
