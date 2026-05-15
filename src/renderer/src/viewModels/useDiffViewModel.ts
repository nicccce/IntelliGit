import type { PatchDetail } from '../../../shared/types'

import { selectSelectedFilePath, selectWorkdirDiff } from '../store/selectors'
import { useDiffStore } from '../store'

interface DiffViewModel {
  selectedFilePath: string | null
  workdirDiff: PatchDetail | null
}

export function useDiffViewModel(): DiffViewModel {
  const selectedFilePath = useDiffStore(selectSelectedFilePath)
  const workdirDiff = useDiffStore(selectWorkdirDiff)

  return {
    selectedFilePath,
    workdirDiff
  }
}
