import { create } from 'zustand'

export type OperationKey =
  | 'repo.load'
  | 'repo.add'
  | 'repo.create'
  | 'repo.clone'
  | 'repo.switch'
  | 'repo.settings'
  | 'staging.add'
  | 'staging.addAll'
  | 'staging.remove'
  | 'staging.applyPatch'
  | 'staging.unstageHunk'
  | 'commit.create'
  | 'commit.checkoutCommit'
  | 'commit.reset'
  | 'branch.checkout'
  | 'remote.push'
  | 'remote.pull'

interface OperationStoreState {
  runningOperations: OperationKey[]
  operationLoading: OperationKey | null
  startOperation: (operation: OperationKey) => void
  finishOperation: (operation: OperationKey) => void
  clearOperations: () => void
}

export const useOperationStore = create<OperationStoreState>((set) => ({
  runningOperations: [],
  operationLoading: null,

  startOperation: (operation) =>
    set((state) => {
      if (state.runningOperations.includes(operation)) return state
      const runningOperations = [...state.runningOperations, operation]
      return { runningOperations, operationLoading: runningOperations[0] || null }
    }),

  finishOperation: (operation) =>
    set((state) => {
      const runningOperations = state.runningOperations.filter((item) => item !== operation)
      return { runningOperations, operationLoading: runningOperations[0] || null }
    }),

  clearOperations: () => set({ runningOperations: [], operationLoading: null })
}))

export async function withOperation<T>(
  operation: OperationKey,
  task: () => Promise<T>
): Promise<T> {
  const operations = useOperationStore.getState()
  operations.startOperation(operation)
  try {
    return await task()
  } finally {
    useOperationStore.getState().finishOperation(operation)
  }
}
