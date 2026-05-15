/**
 * @file SidecarTestPanel.tsx
 * @description 开发阶段的 Sidecar 通信测试界面。
 */

import type { JSX } from 'react'
import { useCallback, useState } from 'react'

import { useKeyboardShortcut } from '../../hooks'
import { classNames } from '../../utils/classNames'
import { useSidecarTestPanelModel } from '../../viewModels'
import styles from './SidecarTestPanel.module.css'

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
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <svg
            className={styles.logo}
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
        <span className={styles.badge}>Sidecar 通信测试</span>
      </header>

      <main className={styles.main}>
        <div className={styles.dashboardGrid}>
          <section className={styles.statusPanel}>
            <div className={styles.panelHeader}>
              <div>
                <p className={styles.panelEyebrow}>运行状态</p>
                <h2>Sidecar 通信面板</h2>
              </div>
              <span
                className={classNames(
                  styles.connectionPill,
                  loading ? styles.connectionPillLoading : styles.connectionPillIdle
                )}
              >
                {loading ? '处理中' : '已就绪'}
              </span>
            </div>

            <div className={styles.statusCards}>
              <article className={classNames(styles.statusCard, styles.accentBlue)}>
                <span className={styles.statusCardLabel}>当前命令</span>
                <strong>{command.trim() || '未输入'}</strong>
              </article>
              <article className={classNames(styles.statusCard, styles.accentGreen)}>
                <span className={styles.statusCardLabel}>历史条目</span>
                <strong>{history.length}</strong>
              </article>
              <article className={classNames(styles.statusCard, styles.accentPurple)}>
                <span className={styles.statusCardLabel}>快捷发送</span>
                <strong>Ctrl + Enter</strong>
              </article>
            </div>

            <div className={styles.statusTip}>
              <span className={styles.statusTipDot} />
              适合先选择快捷命令，再微调 JSON Payload。
            </div>
          </section>

          <section className={styles.inputPanel}>
            <div className={styles.inputGroup}>
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

            <div className={styles.inputGroup}>
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

            <div className={styles.quickActions}>
              <button
                className={classNames(styles.button, styles.secondaryButton)}
                onClick={() => handleQuickCommand('status', { repoPath: '.' })}
                disabled={loading}
              >
                一键执行 status
              </button>
              <button
                className={classNames(styles.button, styles.secondaryButton)}
                onClick={() => handleQuickCommand('log', { repoPath: '.', maxEntries: 20 })}
                disabled={loading}
              >
                一键执行 log
              </button>
            </div>
            <div className={styles.inputActions}>
              <button
                id="btn-execute"
                className={classNames(styles.button, styles.primaryButton)}
                onClick={handleSubmit}
                disabled={loading || !command.trim()}
              >
                {loading ? (
                  <>
                    <span className={styles.spinner} />
                    执行中...
                  </>
                ) : (
                  '发送命令'
                )}
              </button>
              <button
                id="btn-clear"
                className={classNames(styles.button, styles.ghostButton)}
                onClick={clearHistory}
                disabled={history.length === 0}
              >
                清空历史
              </button>
              <span className={styles.shortcutHint}>Ctrl + Enter 快捷发送</span>
            </div>

            {error && (
              <div className={styles.errorBanner}>
                <span className={styles.errorIcon}>⚠</span>
                {error}
              </div>
            )}
          </section>
        </div>

        <section className={styles.resultPanel}>
          <div className={classNames(styles.panelHeader, styles.panelHeaderTight)}>
            <div>
              <p className={styles.panelEyebrow}>日志列表</p>
              <h2>
                执行历史
                {history.length > 0 && (
                  <span className={styles.historyCount}>{history.length}</span>
                )}
              </h2>
            </div>
            {history.length > 0 && (
              <span className={styles.resultSummary}>最近 {history.length} 条记录</span>
            )}
          </div>

          {history.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>⌘</div>
              <p>尚无命令记录</p>
              <p className={styles.emptyHint}>
                输入 Git 命令并点击「发送命令」开始测试 Sidecar 通信链路
              </p>
            </div>
          ) : (
            <div className={styles.historyList}>
              {history.map((record) => (
                <article
                  key={record.id}
                  className={classNames(
                    styles.historyItem,
                    record.success ? styles.historyItemSuccess : styles.historyItemFailure
                  )}
                >
                  <div className={styles.historyMeta}>
                    <div className={styles.historyHeading}>
                      <code className={styles.historyCommand}>
                        <span className={styles.prompt}>$</span> git {record.command}
                      </code>
                      <time className={styles.historyTime}>
                        {new Date(record.timestamp).toLocaleTimeString()}
                      </time>
                    </div>
                    <span
                      className={classNames(
                        styles.statusBadge,
                        record.success ? styles.badgeSuccess : styles.badgeError
                      )}
                    >
                      {record.success ? '✓ 成功' : '✗ 失败'}
                    </span>
                  </div>
                  <pre className={styles.historyOutput}>
                    {JSON.stringify(record.response, null, 2)}
                  </pre>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className={styles.footer}>
        <span>🔗 Sidecar Pattern · stdin/stdout JSON</span>
        <span>Electron + React + TypeScript + Go</span>
      </footer>
    </div>
  )
}

export default SidecarTestPanel
