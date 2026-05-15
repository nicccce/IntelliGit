/**
 * @file SidecarTestPanel.tsx
 * @description 开发阶段的 Sidecar 通信测试界面。
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'

import { useKeyboardShortcut } from '../../hooks'
import { useSidecarTestPanelModel } from '../../viewModels'

function SidecarTestPanel(): JSX.Element {
  const [command, setCommand] = useState('')
  const [payloadStr, setPayloadStr] = useState('{}')
  const { loading, history, error, executeCommand, clearHistory } = useSidecarTestPanelModel()

  const handleSubmit = useCallback(() => {
    if (!command.trim()) return

    let payload: Record<string, unknown> | undefined
    try {
      const parsed = JSON.parse(payloadStr)
      payload = typeof parsed === 'object' && parsed !== null ? parsed : undefined
    } catch {
      payload = undefined
    }

    executeCommand(command.trim(), payload)
  }, [command, executeCommand, payloadStr])

  const handleQuickCommand = useCallback(
    (quickCommand: string, defaultPayload: Record<string, unknown>) => {
      setCommand(quickCommand)
      setPayloadStr(JSON.stringify(defaultPayload, null, 2))
      executeCommand(quickCommand, defaultPayload)
    },
    [executeCommand]
  )

  useKeyboardShortcut('Enter', handleSubmit, { ctrl: true })

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-brand">
          <svg
            className="header-logo"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 2L2 7L12 12L22 7L12 2Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2 17L12 22L22 17"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M2 12L12 17L22 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <h1>IntelliGit</h1>
        </div>
        <span className="header-badge">Sidecar 通信测试</span>
      </header>

      <main className="app-main">
        <div className="dashboard-grid">
          <section className="status-panel">
            <div className="panel-header">
              <div>
                <p className="panel-eyebrow">运行状态</p>
                <h2>Sidecar 通信面板</h2>
              </div>
              <span className={`connection-pill ${loading ? 'is-loading' : 'is-idle'}`}>
                {loading ? '处理中' : '已就绪'}
              </span>
            </div>

            <div className="status-cards">
              <article className="status-card accent-blue">
                <span className="status-card-label">当前命令</span>
                <strong>{command.trim() || '未输入'}</strong>
              </article>
              <article className="status-card accent-green">
                <span className="status-card-label">历史条目</span>
                <strong>{history.length}</strong>
              </article>
              <article className="status-card accent-purple">
                <span className="status-card-label">快捷发送</span>
                <strong>Ctrl + Enter</strong>
              </article>
            </div>

            <div className="status-tip">
              <span className="status-tip-dot" />
              适合先选择快捷命令，再微调 JSON Payload。
            </div>
          </section>

          <section className="input-panel">
            <div className="input-group">
              <label htmlFor="git-command">Git 命令</label>
              <input
                id="git-command"
                type="text"
                placeholder="输入命令，如：status、log、diff ..."
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.ctrlKey) {
                    handleSubmit()
                  }
                }}
                disabled={loading}
                autoFocus
              />
            </div>

            <div className="input-group">
              <label htmlFor="git-payload">Payload（JSON）</label>
              <textarea
                id="git-payload"
                placeholder='{"repoPath": "/path/to/repo"}'
                value={payloadStr}
                onChange={(event) => setPayloadStr(event.target.value)}
                disabled={loading}
                rows={3}
              />
            </div>

            <div className="quick-actions">
              <button
                className="btn btn-secondary"
                onClick={() => handleQuickCommand('status', { repoPath: '.' })}
                disabled={loading}
              >
                一键执行 status
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => handleQuickCommand('log', { repoPath: '.', maxEntries: 20 })}
                disabled={loading}
              >
                一键执行 log
              </button>
            </div>
            <div className="input-actions">
              <button
                id="btn-execute"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={loading || !command.trim()}
              >
                {loading ? (
                  <>
                    <span className="spinner" />
                    执行中...
                  </>
                ) : (
                  '发送命令'
                )}
              </button>
              <button
                id="btn-clear"
                className="btn btn-ghost"
                onClick={clearHistory}
                disabled={history.length === 0}
              >
                清空历史
              </button>
              <span className="shortcut-hint">Ctrl + Enter 快捷发送</span>
            </div>

            {error && (
              <div className="error-banner">
                <span className="error-icon">⚠</span>
                {error}
              </div>
            )}
          </section>
        </div>

        <section className="result-panel">
          <div className="panel-header panel-header-tight">
            <div>
              <p className="panel-eyebrow">日志列表</p>
              <h2>
                执行历史
                {history.length > 0 && <span className="history-count">{history.length}</span>}
              </h2>
            </div>
            {history.length > 0 && (
              <span className="result-summary">最近 {history.length} 条记录</span>
            )}
          </div>

          {history.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">⌘</div>
              <p>尚无命令记录</p>
              <p className="empty-hint">输入 Git 命令并点击「发送命令」开始测试 Sidecar 通信链路</p>
            </div>
          ) : (
            <div className="history-list">
              {history.map((record) => (
                <article
                  key={record.id}
                  className={`history-item ${record.success ? 'success' : 'failure'}`}
                >
                  <div className="history-meta">
                    <div className="history-heading">
                      <code className="history-command">
                        <span className="prompt">$</span> git {record.command}
                      </code>
                      <time className="history-time">
                        {new Date(record.timestamp).toLocaleTimeString()}
                      </time>
                    </div>
                    <span
                      className={`status-badge ${record.success ? 'badge-success' : 'badge-error'}`}
                    >
                      {record.success ? '✓ 成功' : '✗ 失败'}
                    </span>
                  </div>
                  <pre className="history-output">{JSON.stringify(record.response, null, 2)}</pre>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="app-footer">
        <span>🔗 Sidecar Pattern · stdin/stdout JSON</span>
        <span>Electron + React + TypeScript + Go</span>
      </footer>
    </div>
  )
}

export default SidecarTestPanel
