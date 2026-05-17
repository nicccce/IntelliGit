import type { RepoConfig } from '../../../shared/types'

import {
  selectCommitsAhead,
  selectCommitsBehind,
  selectCurrentBranch,
  selectCurrentRepo,
  selectOperationLabel,
  selectSidecarHealthError,
  selectSidecarHealthStatus,
  selectSidecarLatencyMs
} from '../store/selectors'
import {
  useGitStatusStore,
  useOperationStore,
  useRepositoryStore,
  useSidecarHealthStore,
  type SidecarHealthStatus
} from '../store'

type EngineStatusTone = SidecarHealthStatus

interface StatusBarModel {
  currentRepo: RepoConfig | null
  currentBranch: string
  commitsAhead: number
  commitsBehind: number
  operationLabel: string | null
  engineStatusTone: EngineStatusTone
  engineStatusLabel: string
  engineStatusTitle: string
}

function getEngineStatusLabel(status: SidecarHealthStatus): string {
  if (status === 'ready') return '引擎已就绪'
  if (status === 'checking') return '引擎检测中'
  return '引擎不可用'
}

function getEngineStatusTitle(
  status: SidecarHealthStatus,
  error: string | null,
  latencyMs: number | null
): string {
  if (status === 'ready') {
    return latencyMs === null ? 'Go 后端已响应' : `Go 后端已响应 (${latencyMs}ms)`
  }
  if (status === 'checking') return '正在检测 Go 后端连接'
  return error ? `Go 后端不可用：${error}` : 'Go 后端不可用'
}

export function useStatusBarModel(): StatusBarModel {
  const currentRepo = useRepositoryStore(selectCurrentRepo)
  const currentBranch = useGitStatusStore(selectCurrentBranch)
  const commitsAhead = useGitStatusStore(selectCommitsAhead)
  const commitsBehind = useGitStatusStore(selectCommitsBehind)
  const operationLabel = useOperationStore(selectOperationLabel)
  const engineStatus = useSidecarHealthStore(selectSidecarHealthStatus)
  const engineError = useSidecarHealthStore(selectSidecarHealthError)
  const engineLatencyMs = useSidecarHealthStore(selectSidecarLatencyMs)

  return {
    currentRepo,
    currentBranch,
    commitsAhead,
    commitsBehind,
    operationLabel,
    engineStatusTone: engineStatus,
    engineStatusLabel: getEngineStatusLabel(engineStatus),
    engineStatusTitle: getEngineStatusTitle(engineStatus, engineError, engineLatencyMs)
  }
}
