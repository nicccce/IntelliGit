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
  useLlmConfigStore,
  type SidecarHealthStatus
} from '../store'
import type { AgentStatus } from '../agent/types'

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
  aiStatusTone: AgentStatus
  aiStatusLabel: string
  aiStatusTitle: string
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

function getAiStatusLabel(status: AgentStatus): string {
  if (status === 'ready') return 'AI 已就绪'
  if (status === 'checking') return 'AI 检测中'
  if (status === 'error') return 'AI 不可用'
  return 'AI 未配置'
}

function getAiStatusTitle(status: AgentStatus, error: string | null): string {
  if (status === 'ready') return 'AI 服务已连接，点击左侧设置图标配置'
  if (status === 'checking') return '正在检测 AI 服务连接'
  if (status === 'error') return error ? `AI 服务连接失败：${error}` : 'AI 服务连接失败'
  return '未配置 AI 服务，点击左侧设置图标进行配置'
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
  const aiStatus = useLlmConfigStore((s) => s.status)
  const aiError = useLlmConfigStore((s) => s.error)

  return {
    currentRepo,
    currentBranch,
    commitsAhead,
    commitsBehind,
    operationLabel,
    engineStatusTone: engineStatus,
    engineStatusLabel: getEngineStatusLabel(engineStatus),
    engineStatusTitle: getEngineStatusTitle(engineStatus, engineError, engineLatencyMs),
    aiStatusTone: aiStatus,
    aiStatusLabel: getAiStatusLabel(aiStatus),
    aiStatusTitle: getAiStatusTitle(aiStatus, aiError)
  }
}
