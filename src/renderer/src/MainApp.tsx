/* eslint-disable prettier/prettier */
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
    case '?': return '＋'
    default: return ' '
  }
}
function statusColor(code: string): string {
  switch (code) {
    case 'M': return 'var(--accent-orange)'
    case 'A': return 'var(--accent-green)'
    case 'D': return 'var(--accent-red)'
    case '?': return 'var(--accent-green)'
    default: return 'var(--text-secondary)'
  }
}

// ═══════════════════════════════════════════════════════════════
//  仓库侧边栏
// ═══════════════════════════════════════════════════════════════
function RepoSidebar(): React.JSX.Element {
  const { repos, currentRepo, switchRepo, addRepo, createRepo, cloneRepo, removeRepo } = useAppStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [modal, setModal] = useState<'create' | 'add' | 'clone' | null>(null)
  const [loadingAction, setLoadingAction] = useState(false)

  const [createRepoName, setCreateRepoName] = useState('')
  const [createLocation, setCreateLocation] = useState('')
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloneLocation, setCloneLocation] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)

  const [createLocationExists, setCreateLocationExists] = useState<boolean | null>(null)
  const [createLocationIsRepo, setCreateLocationIsRepo] = useState<boolean | null>(null)
  const [cloneLocationExists, setCloneLocationExists] = useState<boolean | null>(null)
  const [cloneLocationIsEmpty, setCloneLocationIsEmpty] = useState<boolean | null>(null)

  const closeModal = useCallback(() => {
    setModal(null)
    setModalError(null)
    setCreateLocationIsRepo(null)
  }, [])

  const handleChooseCreateLocation = useCallback(async () => {
    const path = await window.electronAPI.openFolderDialog()
    if (path) {
      setCreateLocation(path)
      const exists = await window.electronAPI.checkDirExists(path)
      setCreateLocationExists(exists)
      if (exists) {
        const response = await window.electronAPI.invokeGit('repo.open', { path })
        setCreateLocationIsRepo(response.success)
      } else {
        setCreateLocationIsRepo(null)
      }
    }
  }, [])

  const handleChooseCloneLocation = useCallback(async () => {
    const path = await window.electronAPI.openFolderDialog()
    if (path) {
      setCloneLocation(path)
      const exists = await window.electronAPI.checkDirExists(path)
      const isEmpty = await window.electronAPI.checkDirEmpty(path)
      setCloneLocationExists(exists)
      setCloneLocationIsEmpty(isEmpty)
    }
  }, [])

  const handleCreateLocationChange = useCallback(async (value: string) => {
    setCreateLocation(value)
    if (value.trim()) {
      const pathValue = value.trim()
      const exists = await window.electronAPI.checkDirExists(pathValue)
      setCreateLocationExists(exists)
      if (exists) {
        const response = await window.electronAPI.invokeGit('repo.open', { path: pathValue })
        setCreateLocationIsRepo(response.success)
      } else {
        setCreateLocationIsRepo(null)
      }
    } else {
      setCreateLocationExists(null)
      setCreateLocationIsRepo(null)
    }
  }, [])

  const handleCloneLocationChange = useCallback(async (value: string) => {
    setCloneLocation(value)
    if (value.trim()) {
      const exists = await window.electronAPI.checkDirExists(value.trim())
      const isEmpty = await window.electronAPI.checkDirEmpty(value.trim())
      setCloneLocationExists(exists)
      setCloneLocationIsEmpty(isEmpty)
    } else {
      setCloneLocationExists(null)
      setCloneLocationIsEmpty(null)
    }
  }, [])

  const handleCreateConfirm = useCallback(async () => {
    setModalError(null)
    if (!createRepoName.trim() || !createLocation.trim()) {
      setModalError('请填写仓库名称并选择位置。')
      return
    }

    if (createLocationExists !== true) {
      setModalError('存储位置目录不存在。')
      return
    }

    // 创建仓库到用户选择的目录
    const targetPath = createLocation.trim()
    setLoadingAction(true)
    try {
      const result = await createRepo(targetPath)
      if (!result.success) {
        setModalError(result.error || '创建仓库失败，请检查输入后重试。')
        return
      }
      setCreateRepoName('')
      setCreateLocation('')
      setCreateLocationExists(null)
      closeModal()
    } finally {
      setLoadingAction(false)
    }
  }, [createLocation, createRepo, createRepoName, closeModal])

  const handleAddConfirm = useCallback(async () => {
    setModalError(null)
    if (!createLocation.trim()) {
      setModalError('请先选择仓库路径。')
      return
    }

    if (createLocationExists !== true) {
      setModalError('仓库路径不存在。')
      return
    }

    setLoadingAction(true)
    try {
      let isRepo = createLocationIsRepo
      if (isRepo !== true) {
        const response = await window.electronAPI.invokeGit('repo.open', { path: createLocation.trim() })
        isRepo = response.success
        setCreateLocationIsRepo(isRepo)
      }

      if (!isRepo) {
        setModalError('所选路径不是有效的 Git 仓库。')
        return
      }

      const result = await addRepo(createLocation.trim())
      if (!result.success) {
        setModalError(result.error || '添加仓库失败，请检查路径是否为有效仓库。')
        return
      }

      setCreateLocation('')
      setCreateLocationExists(null)
      setCreateLocationIsRepo(null)
      closeModal()
    } finally {
      setLoadingAction(false)
    }
  }, [addRepo, createLocation, createLocationExists, createLocationIsRepo, closeModal])

  const handleCloneConfirm = useCallback(async () => {
    setModalError(null)
    if (!cloneUrl.trim() || !cloneLocation.trim()) {
      setModalError('请填写远程地址并选择克隆位置。')
      return
    }

    if (cloneLocationExists !== true) {
      setModalError('克隆位置目录不存在。')
      return
    }

    if (cloneLocationIsEmpty !== true) {
      setModalError('克隆位置必须是空目录。')
      return
    }

    // 克隆到用户选择的目录，不自动创建子目录
    const targetPath = cloneLocation.trim()
    setLoadingAction(true)
    try {
      const result = await cloneRepo(cloneUrl.trim(), targetPath)
      if (!result.success) {
        setModalError(result.error || '克隆仓库失败，请检查地址与位置。')
        return
      }
      setCloneUrl('')
      setCloneLocation('')
      setCloneLocationExists(null)
      setCloneLocationIsEmpty(null)
      closeModal()
    } finally {
      setLoadingAction(false)
    }
  }, [cloneLocation, cloneRepo, cloneUrl, cloneLocationExists, cloneLocationIsEmpty, closeModal])

  useEffect(() => {
    const handleOutside = (): void => setMenuOpen(false)
    if (menuOpen) {
      document.addEventListener('click', handleOutside)
      return () => document.removeEventListener('click', handleOutside)
    }
    return undefined
  }, [menuOpen])

  return (
    <aside className="ig-sidebar" id="repo-sidebar">
      <div className="ig-sidebar-header">
        <h2>仓库</h2>
        <div className="ig-repo-actions">
          <button
            id="btn-add-repo"
            className="ig-icon-btn"
            title="仓库操作"
            onClick={(event) => { event.stopPropagation(); setMenuOpen(!menuOpen) }}
            disabled={loadingAction}
          >
            {loadingAction ? '…' : '＋'}
          </button>
          {menuOpen && (
            <div className="ig-dropdown ig-repo-dropdown" onClick={(e) => e.stopPropagation()}>
              <div className="ig-dropdown-item" onClick={() => { setModal('create'); setMenuOpen(false) }}>
                创建仓库
              </div>
              <div className="ig-dropdown-item" onClick={() => { setModal('add'); setMenuOpen(false) }}>
                添加仓库
              </div>
              <div className="ig-dropdown-item" onClick={() => { setModal('clone'); setMenuOpen(false) }}>
                克隆仓库
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ig-sidebar-list">
        {repos.length === 0 ? (
          <div className="ig-sidebar-empty">
            <p>尚无仓库</p>
            <p className="ig-hint">点击 ＋ 新建、添加或克隆仓库</p>
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

      {modal && (
        <div className="ig-modal-backdrop">
          <div className="ig-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ig-modal-header">
              <h3>{modal === 'create' ? '创建仓库' : modal === 'add' ? '添加仓库' : '克隆仓库'}</h3>
            </div>
            <div className="ig-modal-body">
              {modal === 'create' && (
                <>
                  <div className="ig-form-group">
                    <label>仓库名称</label>
                    <input
                      type="text"
                      value={createRepoName}
                      onChange={(e) => setCreateRepoName(e.target.value)}
                      placeholder="请输入仓库名称"
                    />
                  </div>
                  <div className="ig-form-group">
                    <label>存储位置</label>
                    <div className="ig-input-with-button">
                      <input
                        type="text"
                        value={createLocation}
                        onChange={(e) => handleCreateLocationChange(e.target.value)}
                        placeholder="请输入或选择仓库位置"
                      />
                      <button className="btn btn-secondary" onClick={handleChooseCreateLocation}>选择</button>
                    </div>
                    {createLocation.trim() && (
                      <div className={`ig-path-status ${createLocationExists === true ? 'exists' : createLocationExists === false ? 'not-exists' : ''}`}>
                        {createLocationExists === true ? '✓ 目录存在' : createLocationExists === false ? '✗ 目录不存在' : '检查中...'}
                      </div>
                    )}
                  </div>
                </>
              )}
              {modal === 'add' && (
                <>
                  <div className="ig-form-group">
                    <label>仓库路径</label>
                    <div className="ig-input-with-button">
                      <input
                        type="text"
                        value={createLocation}
                        onChange={(e) => handleCreateLocationChange(e.target.value)}
                        placeholder="请输入或选择现有仓库路径"
                      />
                      <button className="btn btn-secondary" onClick={handleChooseCreateLocation}>选择</button>
                    </div>
                    {createLocation.trim() && (
                      <div className={`ig-path-status ${createLocationExists === true ? 'exists' : createLocationExists === false ? 'not-exists' : ''}`}>
                        {createLocationExists === true ? '✓ 目录存在' : createLocationExists === false ? '✗ 目录不存在' : '检查中...'}
                      </div>
                    )}
                    {createLocationExists === true && createLocationIsRepo !== null && (
                      <div className={`ig-path-status ${createLocationIsRepo ? 'exists' : 'not-exists'}`}>
                        {createLocationIsRepo ? '✓ 有效 Git 仓库' : '✗ 不是 Git 仓库'}
                      </div>
                    )}
                  </div>
                </>
              )}
              {modal === 'clone' && (
                <>
                  <div className="ig-form-group">
                    <label>远程仓库地址</label>
                    <input
                      type="text"
                      value={cloneUrl}
                      onChange={(e) => setCloneUrl(e.target.value)}
                      placeholder="https://github.com/user/repo.git"
                    />
                  </div>
                  <div className="ig-form-group">
                    <label>克隆位置</label>
                    <div className="ig-input-with-button">
                      <input
                        type="text"
                        value={cloneLocation}
                        onChange={(e) => handleCloneLocationChange(e.target.value)}
                        placeholder="请输入或选择空目录作为克隆位置"
                      />
                      <button className="btn btn-secondary" onClick={handleChooseCloneLocation}>选择</button>
                    </div>
                    {cloneLocation.trim() && (
                      <div className={`ig-path-status ${cloneLocationExists === true ? 'exists' : cloneLocationExists === false ? 'not-exists' : ''}`}>
                        {cloneLocationExists === true ? '✓ 目录存在' : cloneLocationExists === false ? '✗ 目录不存在' : '检查中...'}
                        {cloneLocationExists === true && cloneLocationIsEmpty === true && '，且为空目录'}
                        {cloneLocationExists === true && cloneLocationIsEmpty === false && '，但不为空目录'}
                      </div>
                    )}
                  </div>
                </>
              )}
              {modalError && <div className="ig-form-error">{modalError}</div>}
            </div>
            <div className="ig-modal-footer">
              <button className="btn btn-secondary" onClick={closeModal}>取消</button>
              {modal === 'add' ? (
                <button
                  className="btn btn-primary"
                  onClick={handleAddConfirm}
                  disabled={!createLocation || loadingAction}
                >
                  {loadingAction ? <><span className="spinner" /> 正在验证…</> : '确认'}
                </button>
              ) : modal === 'create' ? (
                <button
                  className="btn btn-primary"
                  onClick={handleCreateConfirm}
                  disabled={!createRepoName.trim() || !createLocation || loadingAction}
                >
                  {loadingAction ? <><span className="spinner" /> 创建中…</> : '确认'}
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={handleCloneConfirm}
                  disabled={!cloneUrl.trim() || !cloneLocation || loadingAction}
                >
                  {loadingAction ? <><span className="spinner" /> 克隆中…</> : '确认'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

// ═══════════════════════════════════════════════════════════════
//  顶部工具栏
// ═══════════════════════════════════════════════════════════════
function Toolbar(): React.JSX.Element {
  const { currentRepo, currentBranch, branches, remoteBranches, activeView, setActiveView,
      pull, push, refreshAll, refreshAllLocal, operationLoading, checkoutBranch, commitsAhead, commitsBehind } = useAppStore()
    const [branchDropdown, setBranchDropdown] = useState(false)

    const hasRemote = currentRepo?.remoteType && currentRepo.remoteType !== 'none'
    const hasCommitsToPush = hasRemote && commitsAhead > 0 && commitsBehind === 0
    const hasCommitsToPull = hasRemote && commitsBehind > 0

    // 构建合并分支列表：本地分支 + 远程特有分支
    const localBranchNames = new Set(branches.map(b => b.name))
    const remoteOnlyBranches = remoteBranches
      .filter(rb => !localBranchNames.has(rb.name.replace(/^origin\//, '')))
      .map(rb => ({ ...rb, name: rb.name.replace(/^origin\//, '') }))
    const mergedBranches = [
      ...branches.filter(b => !b.isRemote),
      ...remoteOnlyBranches
    ]

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
                  {mergedBranches.length === 0 ? (
                    <div className="ig-dropdown-item ig-dropdown-empty">无分支</div>
                  ) : mergedBranches.map(b => {
                    const isRemoteOnly = remoteOnlyBranches.some(rb => rb.name === b.name)
                    return (
                      <div
                        key={b.name}
                        className={`ig-dropdown-item ${b.isHead ? 'active' : ''}`}
                        onClick={() => {
                          checkoutBranch(b.name)
                          setBranchDropdown(false)
                        }}
                      >
                        {b.isHead && <span className="ig-check">✓</span>}
                        <span className="ig-branch-name">{b.name}</span>
                        {isRemoteOnly && <span className="ig-branch-tag ig-branch-tag-remote">远程</span>}
                        {!isRemoteOnly && b.name !== currentBranch && <span className="ig-branch-tag ig-branch-tag-local">本地</span>}
                      </div>
                    )
                  })}
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
        {hasRemote && (
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
        )}
        <button className="ig-icon-btn" onClick={hasRemote ? refreshAll : refreshAllLocal}
          disabled={!currentRepo || !!operationLoading} title={hasRemote ? '刷新（含远程）' : '刷新'}>
          🔄
        </button>
      </div>
    </header>
  )
}

// ═══════════════════════════════════════════════════════════════
//  Diff 视图组件
// ═══════════════════════════════════════════════════════════════
function DiffView(): React.JSX.Element {
  const { workdirDiff, selectedFilePath } = useAppStore()
  if (!selectedFilePath) return <div className="ig-diff-empty">← 选择文件查看差异</div>
  if (!workdirDiff || workdirDiff.filePatches.length === 0) return <div className="ig-diff-empty">无差异内容</div>

  return (
    <div className="ig-diff-scroll">
      {workdirDiff.filePatches.map((fp, fi) => (
        <div key={fi}>
          {fp.isBinary ? <div className="ig-diff-binary">二进制文件</div> : fp.chunks.map((chunk, ci) => {
            const lines = chunk.content.replace(/\n$/, '').split('\n')
            return (
              <div key={ci} className="ig-diff-chunk">
                {chunk.type !== 'Equal' && (
                  <div className="ig-diff-hunk-hdr">
                    <span>{chunk.type === 'Add' ? '新增' : '删除'} {lines.length} 行</span>
                  </div>
                )}
                {lines.map((line, li) => (
                  <div key={li} className={`ig-diff-line ${chunk.type === 'Add' ? 'added' : chunk.type === 'Delete' ? 'removed' : ''}`}>
                    <span className="ig-diff-ln">{li + 1}</span>
                    <span className="ig-diff-lc">{chunk.type === 'Add' ? '+' : chunk.type === 'Delete' ? '-' : ' '} {line}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  变更视图（参照 intelligit_commit_workspace.html）
// ═══════════════════════════════════════════════════════════════
function ChangesView(): React.JSX.Element {
  const { fileStatuses, addFile, addAll, removeFile, createCommit,
    operationLoading, currentRepo, selectedFilePath, selectFile } = useAppStore()
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
        <div className="ig-file-section">
          <div className="ig-file-section-header">
            <h3>已暂存 ({staged.length})</h3>
          </div>
          <div className="ig-file-list">
            {staged.length === 0 ? (
              <div className="ig-file-empty">无暂存文件</div>
            ) : staged.map(f => (
              <div key={`s-${f.path}`}
                className={`ig-file-item ${selectedFilePath === f.path ? 'active' : ''}`}
                onClick={() => selectFile(f.path)}>
                <span className="ig-file-status" style={{ color: statusColor(f.staging) }}>{statusIcon(f.staging)}</span>
                <span className="ig-file-path">{f.path}</span>
                <button className="ig-icon-btn ig-icon-btn-sm" title="取消暂存"
                  onClick={(e) => { e.stopPropagation(); removeFile(f.path) }}>−</button>
              </div>
            ))}
          </div>
        </div>
        <div className="ig-file-section">
          <div className="ig-file-section-header">
            <h3>未暂存 ({unstaged.length})</h3>
            <button className="ig-sm-btn" onClick={addAll}
              disabled={unstaged.length === 0 || !!operationLoading}>全部暂存</button>
          </div>
          <div className="ig-file-list">
            {unstaged.length === 0 ? (
              <div className="ig-file-empty">工作区干净 ✨</div>
            ) : unstaged.map(f => (
              <div key={`u-${f.path}`}
                className={`ig-file-item ${selectedFilePath === f.path ? 'active' : ''}`}
                onClick={() => selectFile(f.path)}>
                <span className="ig-file-status" style={{ color: statusColor(f.worktree || f.staging) }}>{statusIcon(f.worktree || f.staging)}</span>
                <span className="ig-file-path">{f.path}</span>
                <button className="ig-icon-btn ig-icon-btn-sm" title="暂存"
                  onClick={(e) => { e.stopPropagation(); addFile(f.path) }}>＋</button>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Diff 视图 */}
      <div className="ig-diff-view">
        <div className="ig-diff-header"><span className="ig-diff-title">{selectedFilePath || '选择文件查看差异'}</span></div>
        <DiffView />
      </div>
      {/* 提交面板 */}
      <div className="ig-commit-panel">
        <div className="ig-commit-panel-top">提交</div>
        <button className="ig-ai-btn" disabled title="AI 生成提交信息（即将推出）">
          <span className="ig-ai-dot" /> AI 生成提交信息
        </button>
        <textarea id="commit-message" className="ig-commit-input"
          placeholder="输入提交信息…" value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)} rows={3} />
        <button id="btn-commit" className="btn btn-primary ig-commit-btn"
          onClick={handleCommit}
          disabled={!commitMsg.trim() || staged.length === 0 || !!operationLoading}>
          {operationLoading === 'commit' ? <><span className="spinner" /> 提交中…</> : `提交 (${staged.length} 个文件已暂存)`}
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  历史视图（参照 intelligit_branch_graph.html）
// ═══════════════════════════════════════════════════════════════
const GRAPH_COLORS = ['#58a6ff', '#3fb950', '#bc8cff', '#f0883e', '#f85149', '#d29922', '#79c0ff', '#56d364']

function HistoryView(): React.JSX.Element {
  const { allCommitHistory, branches, remoteBranches, currentRepo,
    selectedCommit, selectedCommitFiles, selectCommit,
    fetchAllHistory, checkoutCommit, resetToCommit, operationLoading } = useAppStore()
  const [branchFilter, setBranchFilter] = useState('')
  const [resetMode, setResetMode] = useState<'soft' | 'mixed' | 'hard'>('mixed')
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  useEffect(() => { if (currentRepo) fetchAllHistory() }, [currentRepo])

  if (!currentRepo) return <div className="ig-empty-view"><h3>选择仓库查看历史</h3></div>

  const allBranches = [...branches, ...remoteBranches]
  const filtered = allBranches.filter(b => !branchFilter || b.name.toLowerCase().includes(branchFilter.toLowerCase()))

  // 简化的 lane 分配：根据 commit 的第一个 ref 或 parentHash 分配颜色
  const laneMap = new Map<string, number>()
  let nextLane = 0
  allCommitHistory.forEach(c => {
    if (!laneMap.has(c.hash)) {
      const refLane = c.refs && c.refs.length > 0 ? c.refs[0] : c.parentHashes?.[0] || c.hash
      if (!laneMap.has(refLane)) laneMap.set(refLane, nextLane++ % GRAPH_COLORS.length)
      laneMap.set(c.hash, laneMap.get(refLane) || 0)
    }
  })

  return (
    <div className="ig-history-view" id="history-view">
      {/* 左侧分支面板 */}
      <div className="ig-branch-panel">
        <div className="ig-branch-panel-hdr"><h3>分支</h3></div>
        <input className="ig-branch-search" placeholder="搜索分支…"
          value={branchFilter} onChange={e => setBranchFilter(e.target.value)} />
        <div className="ig-branch-list">
          {filtered.map(b => (
            <div key={b.name} className={`ig-branch-item ${b.isHead ? 'current' : ''}`}>
              <span className="ig-branch-dot" style={{background: b.isRemote ? 'var(--accent-orange)' : 'var(--accent-green)'}} />
              <span className="ig-branch-name">{b.name}</span>
              {b.isHead && <span className="ig-branch-badge">HEAD</span>}
            </div>
          ))}
        </div>
      </div>

      {/* 中间 Commit Graph */}
      <div className="ig-graph-area">
        <div className="ig-graph-header"><h3>Commit Graph ({allCommitHistory.length})</h3></div>
        <div className="ig-graph-list">
          {allCommitHistory.length === 0 ? (
            <div className="ig-file-empty">暂无提交记录</div>
          ) : allCommitHistory.map((c) => {
            const lane = laneMap.get(c.hash) || 0
            const color = GRAPH_COLORS[lane % GRAPH_COLORS.length]
            const isMerge = (c.parentHashes?.length || 0) > 1
            return (
              <div key={c.hash}
                className={`ig-graph-row ${selectedCommit?.hash === c.hash ? 'selected' : ''}`}
                onClick={() => selectCommit(c)}>
                <div className="ig-graph-lane">
                  <svg width="20" height="32" viewBox="0 0 20 32">
                    <line x1="10" y1="0" x2="10" y2="32" stroke={color} strokeWidth="2" opacity="0.4" />
                    {isMerge ? (
                      <rect x="4" y="10" width="12" height="12" rx="2" fill={color} />
                    ) : (
                      <circle cx="10" cy="16" r="5" fill={color} />
                    )}
                  </svg>
                </div>
                <div className="ig-graph-info">
                  <div className="ig-graph-msg">
                    {c.message?.split('\n')[0]}
                    {c.refs && c.refs.map(r => (
                      <span key={r} className="ig-ref-badge">{r}</span>
                    ))}
                  </div>
                  <div className="ig-graph-meta">
                    <span>{c.author}</span>
                    <span className="ig-graph-hash">{c.shortHash}</span>
                    <span>{new Date(c.date).toLocaleString('zh-CN', {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 右侧 Commit 详情面板 */}
      <div className="ig-detail-panel">
        {selectedCommit ? (
          <>
            <div className="ig-detail-hdr"><h3>Commit 详情</h3></div>
            <div className="ig-detail-body">
              <div className="ig-detail-hash"><code>{selectedCommit.hash}</code></div>
              <div className="ig-detail-msg">{selectedCommit.message}</div>
              <div className="ig-detail-meta">
                <span>{selectedCommit.author}</span>
                <span>{new Date(selectedCommit.date).toLocaleString('zh-CN')}</span>
              </div>
              {selectedCommitFiles.length > 0 && (
                <div className="ig-detail-files">
                  <div className="ig-detail-files-hdr">变更文件 ({selectedCommitFiles.length})</div>
                  {selectedCommitFiles.map((f, i) => (
                    <div key={i} className="ig-detail-file">
                      <span className="ig-file-status" style={{color: f.action==='insert'?'var(--accent-green)':f.action==='delete'?'var(--accent-red)':'var(--accent-blue)'}}>
                        {f.action === 'insert' ? 'A' : f.action === 'delete' ? 'D' : 'M'}
                      </span>
                      <span>{f.to || f.from}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* 操作按钮 */}
              <div className="ig-detail-actions">
                <button className="ig-action-btn" onClick={() => checkoutCommit(selectedCommit.hash)}
                  disabled={!!operationLoading}>
                  Checkout 到此 Commit
                </button>
                <button className="ig-action-btn warn" onClick={() => setShowResetConfirm(true)}
                  disabled={!!operationLoading}>
                  Reset 到此 Commit
                </button>
              </div>
              {showResetConfirm && (
                <div className="ig-reset-confirm">
                  <div className="ig-reset-label">Reset 模式:</div>
                  <div className="ig-reset-modes">
                    {(['soft','mixed','hard'] as const).map(m => (
                      <label key={m} className={`ig-reset-opt ${resetMode===m?'active':''}`}>
                        <input type="radio" name="resetMode" checked={resetMode===m} onChange={()=>setResetMode(m)} />
                        --{m}
                      </label>
                    ))}
                  </div>
                  <div className="ig-reset-btns">
                    <button className="ig-action-btn warn"
                      onClick={async () => { await resetToCommit(selectedCommit.hash, resetMode); setShowResetConfirm(false) }}>
                      确认 Reset
                    </button>
                    <button className="ig-action-btn" onClick={() => setShowResetConfirm(false)}>取消</button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="ig-detail-empty">← 选择 commit 查看详情</div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  设置视图
// ═══════════════════════════════════════════════════════════════
function SettingsView(): React.JSX.Element {
  const { currentRepo, updateRepoSettings } = useAppStore()
  const [commitAuthorName, setCommitAuthorName] = useState<string>(() => currentRepo?.commitAuthorName || '')
  const [commitAuthorEmail, setCommitAuthorEmail] = useState<string>(() => currentRepo?.commitAuthorEmail || '')
  const [remoteType, setRemoteType] = useState<'none' | 'http' | 'ssh'>(() => currentRepo?.remoteType || 'none')
  const [httpRemoteUrl, setHttpRemoteUrl] = useState<string>(() => currentRepo?.httpRemoteUrl || '')
  const [sshRemoteUrl, setSshRemoteUrl] = useState<string>(() => currentRepo?.sshRemoteUrl || '')
  const [username, setUsername] = useState<string>(() => currentRepo?.authUsername || '')
  const [password, setPassword] = useState<string>(() => currentRepo?.authPassword || '')
  const [sshKeyPath, setSshKeyPath] = useState<string>(() => currentRepo?.sshKeyPath || '')
  const [sshPassword, setSshPassword] = useState<string>(() => currentRepo?.sshPassword || '')

  // SettingsView uses currentRepo initial state, and keying it by repo path
  // ensures full remount when the selected repository changes.

  if (!currentRepo) {
    return <div className="ig-empty-view"><h3>选择仓库进行设置</h3></div>
  }

  const handleRemoteTypeChange = (type: 'none' | 'http' | 'ssh'): void => {
    setRemoteType(type)
  }

  const handleSave = (): void => {
    updateRepoSettings(currentRepo.path, {
      commitAuthorName: commitAuthorName.trim() || undefined,
      commitAuthorEmail: commitAuthorEmail.trim() || undefined,
            remoteType,
      httpRemoteUrl: remoteType === 'http' ? httpRemoteUrl.trim() || undefined : undefined,
      sshRemoteUrl: remoteType === 'ssh' ? sshRemoteUrl.trim() || undefined : undefined,
      authUsername: remoteType === 'http' ? username.trim() || undefined : undefined,
      authPassword: remoteType === 'http' ? password.trim() || undefined : undefined,
      sshKeyPath: remoteType === 'ssh' ? sshKeyPath.trim() || undefined : undefined,
      sshPassword: remoteType === 'ssh' ? sshPassword.trim() || undefined : undefined
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
        <h3>远程仓库</h3>
        <p className="ig-hint">选择远程仓库形式以配置 Push/Pull 等操作使用的远程地址与认证</p>
        <div className="ig-remote-type-group">
          <label className={`ig-remote-option ${remoteType === 'none' ? 'active' : ''}`}>
            <input
              type="radio"
              name="remoteType"
              value="none"
              checked={remoteType === 'none'}
              onChange={() => handleRemoteTypeChange('none')}
            />
            <span>无</span>
          </label>
          <label className={`ig-remote-option ${remoteType === 'http' ? 'active' : ''}`}>
            <input
              type="radio"
              name="remoteType"
              value="http"
              checked={remoteType === 'http'}
              onChange={() => handleRemoteTypeChange('http')}
            />
            <span>HTTP(S)</span>
          </label>
          <label className={`ig-remote-option ${remoteType === 'ssh' ? 'active' : ''}`}>
            <input
              type="radio"
              name="remoteType"
              value="ssh"
              checked={remoteType === 'ssh'}
              onChange={() => handleRemoteTypeChange('ssh')}
            />
            <span>SSH</span>
          </label>
        </div>
        {remoteType !== 'none' && (
          <div className="ig-remote-detail">
                        {remoteType === 'http' && (
              <div className="ig-form-group">
                <label>HTTP(S) 远程地址</label>
                <input
                  type="text"
                  value={httpRemoteUrl}
                  onChange={e => setHttpRemoteUrl(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                />
              </div>
            )}
            {remoteType === 'ssh' && (
              <div className="ig-form-group">
                <label>SSH 远程地址</label>
                <input
                  type="text"
                  value={sshRemoteUrl}
                  onChange={e => setSshRemoteUrl(e.target.value)}
                  placeholder="git@github.com:user/repo.git"
                />
              </div>
                        )}
            {remoteType === 'http' && (
              <>
                <p className="ig-hint">HTTP(S) 认证</p>
                <div className="ig-form-group">
                  <label>用户名</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                    placeholder="用户名" />
                </div>
                <div className="ig-form-group">
                  <label>密码 / Token</label>
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="口令" />
                </div>
              </>
            )}
            {remoteType === 'ssh' && (
              <>
                <p className="ig-hint">SSH 认证</p>
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
              </>
            )}
          </div>
        )}
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
const AUTO_REFRESH_INTERVAL = 1000

// ═══════════════════════════════════════════════════════════════
//  主组件
// ═══════════════════════════════════════════════════════════════
function MainApp(): React.JSX.Element {
  const { configLoaded, loadConfig, activeView, loading, currentRepo,
      refreshAllLocal } = useAppStore()
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
                      refreshAllLocal()
      }, AUTO_REFRESH_INTERVAL)
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [currentRepo?.path, refreshAllLocal])

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
          {activeView === 'settings' && <SettingsView key={currentRepo?.path || 'settings'} />}
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
