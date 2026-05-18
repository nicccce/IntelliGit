import type { DiffSource, DiffStoreState } from '../diffStore'

export const selectSelectedFilePath = (state: DiffStoreState): string | null =>
  state.selectedFilePath

export const selectDiffSource = (state: DiffStoreState): DiffSource | null => state.diffSource

export const selectWorkdirDiff = (state: DiffStoreState): DiffStoreState['workdirDiff'] =>
  state.workdirDiff

export const selectStagedDiff = (state: DiffStoreState): DiffStoreState['stagedDiff'] =>
  state.stagedDiff

export const selectSelectFile = (state: DiffStoreState): DiffStoreState['selectFile'] =>
  state.selectFile
