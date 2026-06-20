import type { PatchDetail } from '../../../shared/types'

import {
  selectDiffSource,
  selectSelectedFilePath,
  selectStagedDiff,
  selectWorkdirDiff
} from '../store/selectors'
import { useDiffStore } from '../store'
import type { DiffSource } from '../store/diffStore'

export type { DiffSource }

interface DiffViewModel {
  selectedFilePath: string | null
  diffSource: DiffSource | null
  workdirDiff: PatchDetail | null
  stagedDiff: PatchDetail | null
  fetchRawDiff: (path: string) => Promise<string>
}

export function useDiffViewModel(): DiffViewModel {
  const selectedFilePath = useDiffStore(selectSelectedFilePath)
  const diffSource = useDiffStore(selectDiffSource)
  const workdirDiff = useDiffStore(selectWorkdirDiff)
  const stagedDiff = useDiffStore(selectStagedDiff)

  return {
    selectedFilePath,
    diffSource,
    workdirDiff,
    stagedDiff,
    fetchRawDiff: useDiffStore.getState().fetchRawDiff
  }
}
