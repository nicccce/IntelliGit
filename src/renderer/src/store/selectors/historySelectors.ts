import type { HistoryStoreState } from '../historyStore'

export const selectAllCommitHistory = (
  state: HistoryStoreState
): HistoryStoreState['allCommitHistory'] => state.allCommitHistory

export const selectSelectedCommit = (
  state: HistoryStoreState
): HistoryStoreState['selectedCommit'] => state.selectedCommit

export const selectSelectedCommitFiles = (
  state: HistoryStoreState
): HistoryStoreState['selectedCommitFiles'] => state.selectedCommitFiles

export const selectSelectCommit = (state: HistoryStoreState): HistoryStoreState['selectCommit'] =>
  state.selectCommit

export const selectFetchAllHistory = (
  state: HistoryStoreState
): HistoryStoreState['fetchAllHistory'] => state.fetchAllHistory
