/**
 * @file MainApp.tsx — IntelliGit 正式前端界面
 * @description GitHub Desktop 风格的 Git 仓库管理界面。
 *              左侧仓库列表 + 右侧工作区（变更/历史/设置三个视图）。
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useAppStore } from './store'

// ── 文件状态图标映射 ─────────────────────────────────────────
function statusIcon(code: string): string {
  switch (code) {
    case 'M': return '●'
    case 'A': return '＋'
    case 'D': return '✕'
    case 'R': return '➜'
    case '?': return '?'
    default: return ' '
  }
}
function statusColor(code: string): string {
  switch (code) {
    case 'M': return 'var(--accent-orange)'
    case 'A': return 'var(--accent-green)'
    case 'D': return 'var(--accent-red)'
    case '?': return 'var(--text-muted)'
    default: return 'var(--text-secondary)'
  }
}

// ═══════════════════════════════════════════════════════════════
//  仓库侧边栏
// ═══════════════════════════════════════════════════════════════
function RepoSidebar(): React.JSX.Element {
  const { repos, currentRepo, switchRepo, addRepo, removeRepo } = useAppStore()
  const [adding, setAdding] = useState(false)

  const handleAddRepo = useCallback(async () => {
    setAdding(true)
    try {
      const path = await window.electronAPI.openFolderDialog()
      if (path) await addRepo(path)
    } finally {
      setAdding(false)
    }
  }, [addRepo])

  return (
    <aside className="ig-sidebar" id="repo-sidebar">
      <div className="ig-sidebar-header">
        <h2>仓库</h2>
        <button
          id="btn-add-repo"
          className="ig-icon-btn"
          title="添加仓库"
          onClick={handleAddRepo}
          disabled={adding}
        >
          {adding ? '…' : '＋'}
        </button>
      </div>
      <div className="ig-sidebar-list">
        {repos.length === 0 ? (
          <div className="ig-sidebar-empty">
            <p>尚无仓库</p>
            <p className="ig-hint">点击 ＋ 添加 Git 仓库</p>
          </div>
        ) : (
          repos.map((r) => (
            <div
              key={r.path}
              className={`ig-sidebar-item ${currentRepo?.path === r.path ? 'active' : ''}`}
              onClick={() => switchRepo(r.path)}
              title={r.path}
            >
              <div className="ig-sidebar-item-icon">📁</div>
              <div className="ig-sidebar-item-info">
                <span className="ig-sidebar-item-name">{r.name}</span>
                <span className="ig-sidebar-item-path">{r.path}</span>
              </div>
              <button
                className="ig-icon-btn ig-icon-btn-sm ig-remove-btn"
                title="移除仓库"
                onClick={(e) => { e.stopPropagation(); removeRepo(r.path) }}
              >✕</button>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

// ═══════════════════════════════════════════════════════════════
//  顶部工具栏
// ═══════════════════════════════════════════════════════════════
function Toolbar(): React.JSX.Element {
  const { currentRepo, currentBranch, branches, activeView, setActiveView,
    pull, push, refreshAll, operationLoading, checkoutBranch, commitsAhead, commitsBehind } = useAppStore()
  const [branchDropdown, setBranchDropdown] = useState(false)

  const hasCommitsToPush = commitsAhead > 0 && commitsBehind === 0
  const hasCommitsToPull = commitsBehind > 0

  return (
    <header className="ig-toolbar" id="main-toolbar">
      <div className="ig-toolbar-left">
        <div className="ig-toolbar-repo-name">
          {currentRepo ? currentRepo.name : 'IntelliGit'}
        </div>
        {currentBranch && (
          <div className="ig-branch-picker" onClick={() => setBranchDropdown(!branchDropdown)}>
            <span className="ig-branch-icon">⎇</span>
            <span>{currentBranch}</span>
            <span className="ig-caret">▾</span>
            {branchDropdown && (
              <div className="ig-dropdown" onClick={(e) => e.stopPropagation()}>
                {branches.filter(b => !b.isRemote).map(b => (
                  <div
                    key={b.name}
                    className={`ig-dropdown-item ${b.isHead ? 'active' : ''}`}
                    onClick={() => { checkoutBranch(b.name); setBranchDropdown(false) }}
                  >
                    {b.isHead && <span className="ig-check">✓</span>}
                    {b.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="ig-toolbar-tabs">
        {(['changes', 'history', 'settings'] as const).map(v => (
          <button
            key={v}
            className={`ig-tab ${activeView === v ? 'active' : ''}`}
            onClick={() => setActiveView(v)}
          >
            {v === 'changes' ? '📝 变更' : v === 'history' ? '📜 历史' : '⚙ 设置'}
          </button>
        ))}
      </div>
      <div className="ig-toolbar-actions">
        <button 
          className="ig-action-btn" 
          onClick={hasCommitsToPush ? push : pull}
          disabled={!currentRepo || !!operationLoading} 
          title={hasCommitsToPush ? "Push commits" : "Pull commits"}
        >
          {operationLoading === 'push' || operationLoading === 'pull' ? (
            <span className="spinner" /> 
          ) : hasCommitsToPush ? (
            `⬆ Push ${commitsAhead}`
          ) : hasCommitsToPull ? (
            `⬇ Pull ${commitsBehind}`
          ) : (
            '⬇ Pull'
          )}
        </button>
        <button className="ig-icon-btn" onClick={refreshAll}
          disabled={!currentRepo || !!operationLoading} title="刷新">
          🔄
        </button>
      </div>
    </header>
  )
}

// ═══════════════════════════════════════════════════════════════
//  变更视图
// ═══════════════════════════════════════════════════════════════
function ChangesView(): React.JSX.Element {
  const { fileStatuses, addFile, addAll, removeFile, createCommit,
    operationLoading, currentRepo } = useAppStore()
  const [commitMsg, setCommitMsg] = useState('')

  const staged = fileStatuses.filter(f => f.staging !== ' ' && f.staging !== '?')
  const unstaged = fileStatuses.filter(f => f.worktree !== ' ' || f.staging === '?')

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) return
    await createCommit(commitMsg.trim())
    setCommitMsg('')
  }, [commitMsg, createCommit])

  if (!currentRepo) {
    return (
      <div className="ig-empty-view">
        <div className="ig-empty-icon">📂</div>
        <h3>选择一个仓库开始</h3>
        <p>从左侧添加或选择 Git 仓库</p>
      </div>
    )
  }

  return (
    <div className="ig-changes-view" id="changes-view">
      <div className="ig-file-lists">
        {/* 已暂存 */}
        <div className="ig-file-section">
          <div className="ig-file-section-header">
            <h3>已暂存 ({staged.length})</h3>
          </div>
          <div className="ig-file-list">
            {staged.length === 0 ? (
              <div className="ig-file-empty">无暂存文件</div>
            ) : staged.map(f => (
              <div key={`s-${f.path}`} className="ig-file-item">
                <span className="ig-file-status" style={{ color: statusColor(f.staging) }}>
                  {statusIcon(f.staging)}
                </span>
                <span className="ig-file-path">{f.path}</span>
                <button className="ig-icon-btn ig-icon-btn-sm" title="取消暂存"
                  onClick={() => removeFile(f.path)}>−</button>
              </div>
            ))}
          </div>
        </div>
        {/* 未暂存 */}
        <div className="ig-file-section">
          <div className="ig-file-section-header">
            <h3>未暂存 ({unstaged.length})</h3>
            <button className="ig-sm-btn" onClick={addAll}
              disabled={unstaged.length === 0 || !!operationLoading}>
              全部暂存
            </button>
          </div>
          <div className="ig-file-list">
            {unstaged.length === 0 ? (
              <div className="ig-file-empty">工作区干净 ✨</div>
            ) : unstaged.map(f => (
              <div key={`u-${f.path}`} className="ig-file-item">
                <span className="ig-file-status" style={{ color: statusColor(f.worktree || f.staging) }}>
                  {statusIcon(f.worktree || f.staging)}
                </span>
                <span className="ig-file-path">{f.path}</span>
                <button className="ig-icon-btn ig-icon-btn-sm" title="暂存"
                  onClick={() => addFile(f.path)}>＋</button>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* 提交面板 */}
      <div className="ig-commit-panel">
        <textarea
          id="commit-message"
          className="ig-commit-input"
          placeholder="输入提交信息…"
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          rows={3}
        />
        <button
          id="btn-commit"
          className="btn btn-primary ig-commit-btn"
          onClick={handleCommit}
          disabled={!commitMsg.trim() || staged.length === 0 || !!operationLoading}
        >
          {operationLoading === 'commit' ? <><span className="spinner" /> 提交中…</> : `提交到 ${useAppStore.getState().currentBranch || 'main'}`}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  历史视图
// ═══════════════════════════════════════════════════════════════
function HistoryView(): React.JSX.Element {
  const { commitHistory, currentRepo } = useAppStore()

  if (!currentRepo) {
    return <div className="ig-empty-view"><h3>选择仓库查看历史</h3></div>
  }

  return (
    <div className="ig-history-view" id="history-view">
      <div className="ig-history-header">
        <h3>提交历史 ({commitHistory.length})</h3>
      </div>
      <div className="ig-history-list">
        {commitHistory.length === 0 ? (
          <div className="ig-file-empty">暂无提交记录</div>
        ) : commitHistory.map((c) => (
          <div key={c.hash} className="ig-commit-item">
            <div className="ig-commit-dot" />
            <div className="ig-commit-info">
              <div className="ig-commit-msg">{c.message}</div>
              <div className="ig-commit-meta">
                <span className="ig-commit-author">{c.author}</span>
                <span className="ig-commit-hash">{c.shortHash}</span>
                <span className="ig-commit-date">
                  {new Date(c.date).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  设置视图
// ═══════════════════════════════════════════════════════════════
function SettingsView(): React.JSX.Element {
  const { currentRepo, updateRepoSettings } = useAppStore()
  const [commitAuthorName, setCommitAuthorName] = useState('')
  const [commitAuthorEmail, setCommitAuthorEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [sshKeyPath, setSshKeyPath] = useState('')
  const [sshPassword, setSshPassword] = useState('')

  useEffect(() => {
    if (currentRepo) {
      setCommitAuthorName(currentRepo.commitAuthorName || '')
      setCommitAuthorEmail(currentRepo.commitAuthorEmail || '')
      setUsername(currentRepo.authUsername || '')
      setPassword(currentRepo.authPassword || '')
      setSshKeyPath(currentRepo.sshKeyPath || '')
      setSshPassword(currentRepo.sshPassword || '')
    }
  }, [currentRepo?.path])

  if (!currentRepo) {
    return <div className="ig-empty-view"><h3>选择仓库进行设置</h3></div>
  }

  const handleSave = (): void => {
    updateRepoSettings(currentRepo.path, {
      commitAuthorName: commitAuthorName.trim() || undefined,
      commitAuthorEmail: commitAuthorEmail.trim() || undefined,
      authUsername: username.trim() || undefined,
      authPassword: password.trim() || undefined,
      sshKeyPath: sshKeyPath.trim() || undefined,
      sshPassword: sshPassword.trim() || undefined
    })
  }

  return (
    <div className="ig-settings-view" id="settings-view">
      <div className="ig-settings-section">
        <h3>仓库信息</h3>
        <div className="ig-settings-info">
          <div className="ig-settings-row">
            <span className="ig-settings-label">名称</span>
            <span className="ig-settings-value">{currentRepo.name}</span>
          </div>
          <div className="ig-settings-row">
            <span className="ig-settings-label">路径</span>
            <span className="ig-settings-value ig-mono">{currentRepo.path}</span>
          </div>
        </div>
      </div>
      <div className="ig-settings-section">
        <h3>提交身份</h3>
        <p className="ig-hint">用于新建 Commit；GitHub 贡献统计按提交邮箱匹配账号</p>
        <div className="ig-form-group">
          <label>作者名称</label>
          <input type="text" value={commitAuthorName} onChange={e => setCommitAuthorName(e.target.value)}
            placeholder="留空时使用 Git 配置或认证用户名" />
        </div>
        <div className="ig-form-group">
          <label>作者邮箱</label>
          <input type="email" value={commitAuthorEmail} onChange={e => setCommitAuthorEmail(e.target.value)}
            placeholder="your-email@example.com" />
        </div>
      </div>
      <div className="ig-settings-section">
        <h3>HTTP(S) 认证</h3>
        <p className="ig-hint">用于 Push/Pull 等远程操作（Token 填入密码字段）</p>
        <div className="ig-form-group">
          <label>用户名</label>
          <input type="text" value={username} onChange={e => setUsername(e.target.value)}
            placeholder="GitHub 用户名" />
        </div>
        <div className="ig-form-group">
          <label>密码 / Token</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Personal Access Token" />
        </div>
      </div>
      <div className="ig-settings-section">
        <h3>SSH 认证</h3>
        <div className="ig-form-group">
          <label>SSH 密钥路径</label>
          <input type="text" value={sshKeyPath} onChange={e => setSshKeyPath(e.target.value)}
            placeholder="~/.ssh/id_rsa" />
        </div>
        <div className="ig-form-group">
          <label>SSH 密钥密码</label>
          <input type="password" value={sshPassword} onChange={e => setSshPassword(e.target.value)}
            placeholder="（可选）" />
        </div>
      </div>
      <button className="btn btn-primary" onClick={handleSave}>保存设置</button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  通知横幅
// ═══════════════════════════════════════════════════════════════
function NotificationBar(): React.JSX.Element | null {
  const { error, successMessage, clearError, clearSuccess } = useAppStore()
  if (error) {
    return (
      <div className="ig-notification ig-notification-error" onClick={clearError}>
        <span>⚠ {error}</span><span className="ig-notification-close">✕</span>
      </div>
    )
  }
  if (successMessage) {
    return (
      <div className="ig-notification ig-notification-success" onClick={clearSuccess}>
        <span>✓ {successMessage}</span>
      </div>
    )
  }
  return null
}

// ── 自动轮询间隔（毫秒） ─────────────────────────────────────
const AUTO_REFRESH_INTERVAL = 3000

// ═══════════════════════════════════════════════════════════════
//  主组件
// ═══════════════════════════════════════════════════════════════
function MainApp(): React.JSX.Element {
  const { configLoaded, loadConfig, activeView, loading, currentRepo,
    refreshStatus } = useAppStore()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  // ── 自动轮询刷新文件状态 ──────────────────────────────────
  useEffect(() => {
    // 清理上一个定时器
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    // 有仓库时启动轮询
    if (currentRepo) {
      timerRef.current = setInterval(() => {
        refreshStatus()
      }, AUTO_REFRESH_INTERVAL)
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [currentRepo?.path, refreshStatus])

  if (!configLoaded) {
    return (
      <div className="ig-loading-screen">
        <div className="spinner" />
        <p>加载中…</p>
      </div>
    )
  }

  return (
    <div className="ig-app">
      <RepoSidebar />
      <div className="ig-main">
        <Toolbar />
        <NotificationBar />
        {loading && currentRepo && (
          <div className="ig-loading-bar"><div className="ig-loading-bar-inner" /></div>
        )}
        <main className="ig-content">
          {activeView === 'changes' && <ChangesView />}
          {activeView === 'history' && <HistoryView />}
          {activeView === 'settings' && <SettingsView />}
        </main>
        <footer className="ig-statusbar">
          <span>{currentRepo ? `📂 ${currentRepo.path}` : 'IntelliGit'}</span>
          <span>Electron + React + Go Sidecar</span>
        </footer>
      </div>
    </div>
  )
}

export default MainApp
