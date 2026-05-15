import type { DiffStoreState } from '../diffStore'

export const selectSelectedFilePath = (state: DiffStoreState): string | null =>
  state.selectedFilePath

export const selectWorkdirDiff = (state: DiffStoreState): DiffStoreState['workdirDiff'] =>
  state.workdirDiff

export const selectSelectFile = (state: DiffStoreState): DiffStoreState['selectFile'] =>
  state.selectFile
