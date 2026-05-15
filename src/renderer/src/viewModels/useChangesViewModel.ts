import { useMemo } from 'react'

import type { FileStatusInfo, RepoConfig } from '../../../shared/types'
import { useDiffStore, useGitStatusStore, useOperationStore, useRepositoryStore } from '../store'
import {
  selectCurrentRepo,
  selectFileStatuses,
  selectOperationLoading,
  selectSelectedFilePath,
  selectSelectFile
} from '../store/selectors'
import { splitFileStatuses } from '../utils/fileStatus'

interface ChangesViewModel {
  currentRepo: RepoConfig | null
  selectedFilePath: string | null
  selectFile: (path: string) => Promise<void>
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
  const selectFile = useDiffStore(selectSelectFile)
  const { staged, unstaged } = useMemo(() => splitFileStatuses(fileStatuses), [fileStatuses])

  return {
    currentRepo,
    selectedFilePath,
    selectFile,
    staged,
    unstaged,
    isBusy: Boolean(operationLoading),
    isCommitRunning: operationLoading === 'commit.create'
  }
}
