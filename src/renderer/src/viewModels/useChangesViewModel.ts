import { useMemo } from 'react'

import type { FileStatusInfo, RepoConfig } from '../../../shared/types'
import { useDiffStore, useGitStatusStore, useOperationStore, useRepositoryStore } from '../store'
import type { DiffSource } from '../store/diffStore'
import {
  selectCurrentRepo,
  selectDiffSource,
  selectFileStatuses,
  selectOperationLoading,
  selectSelectedFilePath,
  selectSelectFile
} from '../store/selectors'
import { splitFileStatuses } from '../utils/fileStatus'

interface ChangesViewModel {
  currentRepo: RepoConfig | null
  selectedFilePath: string | null
  diffSource: DiffSource | null
  selectFile: (path: string, source: DiffSource) => Promise<void>
  staged: FileStatusInfo[]
  unstaged: FileStatusInfo[]
  isBusy: boolean
  isCommitRunning: boolean
}

export function useChangesViewModel(): ChangesViewModel {
  const fileStatuses = useGitStatusStore(selectFileStatuses)
  const operationLoading = useOperationStore(selectOperationLoading)
  const currentRepo = useRepositoryStore(selectCurrentRepo)
  const selectedFilePath = useDiffStore(selectSelectedFilePath)
  const diffSource = useDiffStore(selectDiffSource)
  const selectFile = useDiffStore(selectSelectFile)
  const { staged, unstaged } = useMemo(() => splitFileStatuses(fileStatuses), [fileStatuses])

  return {
    currentRepo,
    selectedFilePath,
    diffSource,
    selectFile,
    staged,
    unstaged,
    isBusy: Boolean(operationLoading),
    isCommitRunning: operationLoading === 'commit.create'
  }
}
