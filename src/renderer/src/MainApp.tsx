/**
 * @file MainApp.tsx — IntelliGit 正式前端界面
 * @description 项目的正式用户界面，提供 Git 仓库管理功能。
 */

import React, { useEffect, useMemo, useState } from 'react'

interface RepoMetric {
  label: string
  value: string
  trend: string
  tone: 'blue' | 'green' | 'purple'
}

interface ActivityItem {
  id: number
  title: string
  detail: string
  time: string
  status: 'ready' | 'warning' | 'info'
}

interface SidecarStatusResponse {
  hash?: string
  branch?: string
  clean?: boolean
}

interface CommitInfo {
  hash: string
  shortHash?: string
  author?: string
  date?: string
  message?: string
}

const mockActivities: ActivityItem[] = [
  {
    id: 1,
    title: '已连接 Sidecar 通道',
    detail: '通过 preload 暴露的 electronAPI 拉取仓库状态。',
    time: '刚刚',
    status: 'ready'
  },
  {
    id: 2,
    title: '刷新仓库信息',
    detail: '正在调用 `git.status` / `git.head` 获取分支与工作区状态。',
    time: '持续同步',
    status: 'info'
  },
  {
    id: 3,
    title: '待接入更多命令',
    detail: '后续可以继续接入 commit / add / reset 等操作。',
    time: '规划中',
    status: 'warning'
  }
]

const fallbackMetrics: RepoMetric[] = [
  { label: '当前分支', value: '未连接', trend: '等待 sidecar 响应', tone: 'blue' },
  { label: '工作区状态', value: '未知', trend: '将从 Git status 读取', tone: 'green' },
  { label: '最近提交', value: '未加载', trend: '通过 log 接口获取', tone: 'purple' }
]

function MainApp(): React.JSX.Element {
  const [tick, setTick] = useState(0)
  const [metrics, setMetrics] = useState<RepoMetric[]>(fallbackMetrics)
  const [recentCommits, setRecentCommits] = useState<CommitInfo[]>([])
  const [connectionState, setConnectionState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [connectionDetail, setConnectionDetail] = useState('正在连接 sidecar...')

  useEffect(() => {
    let alive = true

    const loadRepoState = async (): Promise<void> => {
      if (!window.electronAPI) {
        setConnectionState('error')
        setConnectionDetail('electronAPI 不可用，请检查 preload 连接。')
        return
      }

      setConnectionState('loading')
      setConnectionDetail('正在连接 sidecar...')

      try {
        const [statusResponse, headResponse, logResponse] = await Promise.all([
          window.electronAPI.invokeGit('status'),
          window.electronAPI.invokeGit('head'),
          window.electronAPI.invokeGit('log', { max: 5 })
        ])

        if (!alive) return

        const statusData = (statusResponse?.data ?? {}) as Record<string, unknown>
        const headData = (headResponse?.data ?? {}) as SidecarStatusResponse
        const logData = Array.isArray(logResponse?.data) ? (logResponse.data as CommitInfo[]) : []

        const changedFiles = Array.isArray(statusData.files) ? statusData.files.length : 0
        const stagedFiles = Array.isArray(statusData.staged) ? statusData.staged.length : 0
        const branch = headData.branch ?? 'unknown'
        const hash = headData.hash?.slice(0, 7) ?? 'unknown'
        const clean = headData.clean ?? false

        setMetrics([
          { label: '当前分支', value: branch, trend: `HEAD ${hash}`, tone: 'blue' },
          { label: '未提交文件', value: `${changedFiles} files`, trend: `${stagedFiles} staged`, tone: 'green' },
          { label: '工作区状态', value: clean ? 'clean' : 'dirty', trend: clean ? '无需提交' : '存在修改', tone: 'purple' }
        ])
        setRecentCommits(logData)
        setConnectionState('ready')
        setConnectionDetail('已通过 sidecar 获取到最新仓库状态。')
      } catch (error) {
        if (!alive) return
        const message = error instanceof Error ? error.message : '连接 sidecar 失败'
        setConnectionState('error')
        setConnectionDetail(message)
        setMetrics(fallbackMetrics)
        setRecentCommits([])
      }
    }

    void loadRepoState()
    const timer = window.setInterval(() => {
      setTick((value) => value + 1)
      void loadRepoState()
    }, 5000)

    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  const heartbeat = useMemo(() => {
    if (connectionState === 'error') return '连接失败'
    return tick % 2 === 0 ? '实时同步中' : '正在刷新状态'
  }, [connectionState, tick])

  return (
    <div className="main-app-shell">
      <header className="main-app-hero">
        <div>
          <p className="panel-eyebrow">IntelliGit</p>
          <h1>智能 Git 版本控制工具</h1>
          <p className="hero-copy">当前页面已接入 sidecar 通信，会通过 Electron preload 拉取真实仓库状态。</p>
        </div>
        <div className={`hero-badge ${connectionState}`}>
          <span className="hero-badge-dot" />
          {heartbeat}
        </div>
      </header>

      <main className="main-app-grid">
        <section className="main-app-card main-app-card-wide">
          <div className="panel-header panel-header-tight">
            <div>
              <p className="panel-eyebrow">仓库状态</p>
              <h2>Sidecar Dashboard</h2>
            </div>
            <span className={`result-summary ${connectionState}`}>{connectionDetail}</span>
          </div>

          <div className="status-cards">
            {metrics.map((metric) => (
              <article key={metric.label} className={`status-card accent-${metric.tone}`}>
                <span className="status-card-label">{metric.label}</span>
                <strong>{metric.value}</strong>
                <small className="metric-trend">{metric.trend}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="main-app-card">
          <div className="panel-header panel-header-tight">
            <div>
              <p className="panel-eyebrow">提交历史</p>
              <h2>最近提交</h2>
            </div>
            <span className="result-summary">拉取 `git log -5`</span>
          </div>

          <div className="log-list">
            {recentCommits.length > 0 ? (
              recentCommits.map((commit) => (
                <article key={commit.hash} className="log-item">
                  <div className="log-item-head">
                    <strong>{commit.message?.split('\n')[0] ?? '无提交信息'}</strong>
                    <span>{commit.shortHash ?? commit.hash.slice(0, 7)}</span>
                  </div>
                  <div className="log-item-meta">
                    <span>{commit.author ?? 'unknown author'}</span>
                    <time>{commit.date ? new Date(commit.date).toLocaleString() : 'unknown date'}</time>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                暂无提交历史，等待 sidecar 返回 `git log` 数据。
              </div>
            )}
          </div>
        </section>

        <section className="main-app-card">
          <div className="panel-header panel-header-tight">
            <div>
              <p className="panel-eyebrow">功能区</p>
              <h2>下一步可接入</h2>
            </div>
          </div>
          <ul className="feature-list">
            <li>
              <strong>智能提交</strong>
              <span>自动组织变更摘要、标题和说明</span>
            </li>
            <li>
              <strong>影子合并</strong>
              <span>在真实合并前先预览冲突与影响</span>
            </li>
            <li>
              <strong>智能添加</strong>
              <span>根据文件类型推荐分组和提交策略</span>
            </li>
          </ul>
        </section>
      </main>
    </div>
  )
}

export default MainApp