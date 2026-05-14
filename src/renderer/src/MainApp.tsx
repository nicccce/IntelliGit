/* eslint-disable prettier/prettier */
/**
 * @file MainApp.tsx — IntelliGit 正式前端界面
 * @description GitHub Desktop 风格的 Git 仓库管理界面。
 *              左侧仓库列表 + 右侧工作区（变更/历史/设置三个视图）。
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  App as AntApp,
  Alert,
  Badge,
  Button,
  ConfigProvider,
  Dropdown,
  Empty,
  Input,
  Modal,
  Segmented,
  Select,
  Spin,
  Switch,
  Tag,
  Tooltip,
  theme as antdTheme
} from 'antd'
import type { MenuProps, ThemeConfig } from 'antd'
import {
  BranchesOutlined,
  CheckOutlined,
  CloseOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  CodeOutlined,
  DeleteOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  MoonOutlined,
  PlusOutlined,
  SettingOutlined,
  SunOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { useAppStore } from './store'

type AppThemeMode = 'light' | 'dark'
type AppView = 'changes' | 'history' | 'settings'

const { TextArea } = Input

const VIEW_OPTIONS: Array<{ value: AppView; label: string; icon: React.ReactNode }> = [
  { value: 'changes', label: '变更', icon: <CodeOutlined /> },
  { value: 'history', label: '历史', icon: <HistoryOutlined /> },
  { value: 'settings', label: '设置', icon: <SettingOutlined /> }
]

const ANT_THEME_TOKENS: Record<AppThemeMode, ThemeConfig> = {
  dark: {
    algorithm: antdTheme.darkAlgorithm,
    token: {
      colorPrimary: '#2f81f7',
      colorSuccess: '#1f9d6f',
      colorWarning: '#b7791f',
      colorError: '#e05252',
      colorInfo: '#2f81f7',
      borderRadius: 6,
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      colorBgBase: '#0f1218',
      colorBgContainer: '#161b22',
      colorBorder: '#303845',
      colorTextBase: '#e8edf4'
    },
    components: {
      Button: { controlHeight: 30, borderRadius: 6 },
      Input: { controlHeight: 30, borderRadius: 6 },
      Modal: { borderRadiusLG: 8 },
      Segmented: { borderRadius: 6 }
    }
  },
  light: {
    algorithm: antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: '#185fa5',
      colorSuccess: '#1d9e75',
      colorWarning: '#ba7517',
      colorError: '#d64545',
      colorInfo: '#185fa5',
      borderRadius: 6,
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      colorBgBase: '#f5f7fb',
      colorBgContainer: '#ffffff',
      colorBorder: '#d8dee8',
      colorTextBase: '#1f2937'
    },
    components: {
      Button: { controlHeight: 30, borderRadius: 6 },
      Input: { controlHeight: 30, borderRadius: 6 },
      Modal: { borderRadiusLG: 8 },
      Segmented: { borderRadius: 6 }
    }
  }
}

// ── 文件状态展示映射 ─────────────────────────────────────────
function statusColor(code: string): string {
  switch (code) {
    case 'M': return 'var(--accent-orange)'
    case 'A': return 'var(--accent-green)'
    case 'D': return 'var(--accent-red)'
    case '?': return 'var(--accent-green)'
    default: return 'var(--text-secondary)'
  }
}

function statusLabel(code: string): string {
  switch (code) {
    case 'M': return 'M'
    case 'A': return 'A'
    case 'D': return 'D'
    case 'R': return 'R'
    case '?': return 'U'
    default: return ' '
  }
}

function repoInitials(name: string): string {
  const parts = name
    .replace(/\.git$/i, '')
    .split(/[\s._-]+/)
    .filter(Boolean)

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }

  return (parts[0] || name || 'IG').slice(0, 2).toUpperCase()
}

function ActivityRail({
  themeMode,
  onToggleTheme,
  repoPanelOpen,
  onToggleRepoPanel
}: {
  themeMode: AppThemeMode
  onToggleTheme: () => void
  repoPanelOpen: boolean
  onToggleRepoPanel: () => void
}): React.JSX.Element {
  const { activeView, setActiveView, fileStatuses } = useAppStore()
  const changeCount = fileStatuses.filter(f => f.staging !== ' ' || f.worktree !== ' ').length

    return (
    <nav className="ig-activity-rail" aria-label="主导航">
      <Tooltip title="仓库" placement="right">
        <button
          className={`ig-rail-item ${repoPanelOpen ? 'active' : ''}`}
          type="button"
          onClick={onToggleRepoPanel}
          aria-label="仓库"
        >
          <FolderOpenOutlined />
        </button>
      </Tooltip>
      <div className="ig-rail-divider" />
      {VIEW_OPTIONS.map((item) => {
        const button = (
          <button
            key={item.value}
            className={`ig-rail-item ${activeView === item.value ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveView(item.value)}
            aria-label={item.label}
          >
            {item.icon}
          </button>
        )
        return (
          <Tooltip key={item.value} title={item.label} placement="right">
            {item.value === 'changes' ? (
              <Badge size="small" count={changeCount} overflowCount={99} offset={[-2, 4]}>
                {button}
              </Badge>
            ) : button}
          </Tooltip>
        )
      })}
      <div className="ig-rail-spacer" />
      <Tooltip title={themeMode === 'dark' ? '切换到白天模式' : '切换到黑夜模式'} placement="right">
        <button className="ig-rail-item" type="button" onClick={onToggleTheme} aria-label="切换主题">
          {themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        </button>
      </Tooltip>
    </nav>
  )
}

// ═══════════════════════════════════════════════════════════════
//  仓库面板（可折叠侧边栏）
// ═══════════════════════════════════════════════════════════════
function RepoPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }): React.JSX.Element {
    const { repos, currentRepo, switchRepo, addRepo, createRepo, cloneRepo, removeRepo } = useAppStore()
  const [panelWidth, setPanelWidth] = useState(280)
  const MIN_PANEL_WIDTH = 200
  const MAX_PANEL_WIDTH = 520

  // ── 删除仓库确认状态 ──────────────────────────────────────
  const [repoToRemove, setRepoToRemove] = useState<{ path: string; name: string } | null>(null)
  const [removingRepo, setRemovingRepo] = useState(false)

  const handleResizeMouseDown = useCallback((e: React.MouseEvent): void => {
    e.preventDefault()
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent): void => {
      const newWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, ev.clientX - 52))
      setPanelWidth(newWidth)
    }

    const onMouseUp = (): void => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [])
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

  const repoMenuItems: MenuProps['items'] = [
    { key: 'create', icon: <FolderAddOutlined />, label: '创建仓库' },
    { key: 'add', icon: <FolderOpenOutlined />, label: '添加仓库' },
    { key: 'clone', icon: <CloudDownloadOutlined />, label: '克隆仓库' }
  ]

  const handleRepoMenuClick: MenuProps['onClick'] = ({ key }) => {
    setModal(key as 'create' | 'add' | 'clone')
  }

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
  }, [createLocation, createLocationExists, createRepo, createRepoName, closeModal])

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

  const modalTitle = modal === 'create' ? '创建仓库' : modal === 'add' ? '添加仓库' : '克隆仓库'
  const confirmLabel = modal === 'clone' ? '开始克隆' : modal === 'create' ? '创建' : '添加'
  const confirmDisabled = loadingAction ||
    (modal === 'add' && !createLocation.trim()) ||
    (modal === 'create' && (!createRepoName.trim() || !createLocation.trim())) ||
    (modal === 'clone' && (!cloneUrl.trim() || !cloneLocation.trim()))
    const handleConfirm = modal === 'add' ? handleAddConfirm : modal === 'create' ? handleCreateConfirm : handleCloneConfirm

    return (
      <>
        {/* 遮罩已移除，面板直接展开不影响其他界面 */}
                <aside
        className={`ig-repo-panel ${isOpen ? 'open' : ''}`}
        aria-label="仓库面板"
        style={{ width: isOpen ? panelWidth : 0 }}
      >
                <div className="ig-panel-header">
          <h3>仓库列表</h3>
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
        </div>
        <div className="ig-panel-resize-handle" onMouseDown={handleResizeMouseDown} />
        <div className="ig-panel-body">
          <Dropdown menu={{ items: repoMenuItems, onClick: handleRepoMenuClick }} trigger={['click']} placement="bottomLeft">
            <Button className="ig-panel-add-btn" block icon={<PlusOutlined />}>
              添加仓库
            </Button>
          </Dropdown>
                    <div className="ig-panel-repo-list">
            {repos.length === 0 ? (
              <div className="ig-panel-empty">暂无仓库，点击上方按钮添加</div>
            ) : repos.map((r) => (
              <Dropdown
                key={r.path}
                menu={{
                  items: [
                    {
                      key: 'remove',
                      icon: <DeleteOutlined />,
                      label: '删除仓库',
                      danger: true,
                      onClick: () => setRepoToRemove({ path: r.path, name: r.name })
                    }
                  ]
                }}
                trigger={['contextMenu']}
              >
                <div
                  className={`ig-panel-repo-item ${currentRepo?.path === r.path ? 'active' : ''}`}
                  onClick={() => switchRepo(r.path)}
                >
                  <span className="ig-repo-initials">{repoInitials(r.name)}</span>
                  <div className="ig-repo-info">
                    <strong>{r.name}</strong>
                    <small>{r.path}</small>
                  </div>
                  <div className="ig-repo-actions">
                    {currentRepo?.path === r.path && <CheckOutlined className="ig-repo-check" />}
                    <Tooltip title="删除仓库（仅移除列表，不删除本地文件）">
                      <Button
                        type="text"
                        size="small"
                        className="ig-repo-delete-btn"
                        icon={<CloseOutlined />}
                        onClick={(e) => {
                          e.stopPropagation()
                          setRepoToRemove({ path: r.path, name: r.name })
                        }}
                      />
                    </Tooltip>
                  </div>
                </div>
              </Dropdown>
            ))}
          </div>
        </div>
      </aside>

            <Modal
        open={!!modal}
        title={modalTitle}
        onCancel={closeModal}
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={closeModal}>取消</Button>,
          <Button key="ok" type="primary" loading={loadingAction} disabled={confirmDisabled} onClick={handleConfirm}>
            {confirmLabel}
          </Button>
        ]}
      >
        <div className="ig-modal-body">
          {modal === 'create' && (
            <>
              <div className="ig-form-group">
                <label>仓库名称</label>
                <Input
                  value={createRepoName}
                  onChange={(e) => setCreateRepoName(e.target.value)}
                  placeholder="请输入仓库名称"
                />
              </div>
              <div className="ig-form-group">
                <label>存储位置</label>
                <Input.Search
                  value={createLocation}
                  onChange={(e) => handleCreateLocationChange(e.target.value)}
                  onSearch={handleChooseCreateLocation}
                  enterButton="选择"
                  placeholder="请输入或选择仓库位置"
                />
                {createLocation.trim() && (
                  <Alert
                    className="ig-path-alert"
                    type={createLocationExists === true ? 'success' : createLocationExists === false ? 'error' : 'info'}
                    showIcon
                    message={createLocationExists === true ? '目录存在' : createLocationExists === false ? '目录不存在' : '检查中...'}
                  />
                )}
              </div>
            </>
          )}
          {modal === 'add' && (
            <div className="ig-form-group">
              <label>仓库路径</label>
              <Input.Search
                value={createLocation}
                onChange={(e) => handleCreateLocationChange(e.target.value)}
                onSearch={handleChooseCreateLocation}
                enterButton="选择"
                placeholder="请输入或选择现有仓库路径"
              />
              {createLocation.trim() && (
                <Alert
                  className="ig-path-alert"
                  type={createLocationExists === true ? 'success' : createLocationExists === false ? 'error' : 'info'}
                  showIcon
                  message={createLocationExists === true ? '目录存在' : createLocationExists === false ? '目录不存在' : '检查中...'}
                />
              )}
              {createLocationExists === true && createLocationIsRepo !== null && (
                <Alert
                  className="ig-path-alert"
                  type={createLocationIsRepo ? 'success' : 'error'}
                  showIcon
                  message={createLocationIsRepo ? '有效 Git 仓库' : '不是 Git 仓库'}
                />
              )}
            </div>
          )}
          {modal === 'clone' && (
            <>
              <div className="ig-form-group">
                <label>远程仓库地址</label>
                <Input
                  value={cloneUrl}
                  onChange={(e) => setCloneUrl(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                />
              </div>
              <div className="ig-form-group">
                <label>克隆位置</label>
                <Input.Search
                  value={cloneLocation}
                  onChange={(e) => handleCloneLocationChange(e.target.value)}
                  onSearch={handleChooseCloneLocation}
                  enterButton="选择"
                  placeholder="请输入或选择空目录作为克隆位置"
                />
                {cloneLocation.trim() && (
                  <Alert
                    className="ig-path-alert"
                    type={cloneLocationExists === true && cloneLocationIsEmpty === true ? 'success' : cloneLocationExists === false || cloneLocationIsEmpty === false ? 'error' : 'info'}
                    showIcon
                    message={
                      cloneLocationExists === true && cloneLocationIsEmpty === true
                        ? '目录存在，且为空目录'
                        : cloneLocationExists === true && cloneLocationIsEmpty === false
                          ? '目录存在，但不为空目录'
                          : cloneLocationExists === false ? '目录不存在' : '检查中...'
                    }
                  />
                )}
              </div>
            </>
          )}
          {modalError && <Alert type="error" showIcon message={modalError} />}
                </div>
      </Modal>

      {/* ── 删除仓库确认对话框 ──────────────────────────────── */}
      <Modal
        open={!!repoToRemove}
        title="删除仓库"
        onCancel={() => setRepoToRemove(null)}
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={() => setRepoToRemove(null)}>取消</Button>,
          <Button
            key="remove"
            type="primary"
            danger
            loading={removingRepo}
            onClick={async () => {
              if (!repoToRemove) return
              setRemovingRepo(true)
              try {
                await removeRepo(repoToRemove.path)
                setRepoToRemove(null)
              } finally {
                setRemovingRepo(false)
              }
            }}
          >
            确认删除
          </Button>
        ]}
      >
        <div className="ig-modal-body">
          <p>
            确定要从仓库列表中移除 <strong>{repoToRemove?.name}</strong> 吗？
          </p>
          <Alert
            type="info"
            showIcon
            message="仅从应用列表中删除仓库记录，不会删除本地仓库文件。"
          />
        </div>
      </Modal>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════
//  顶部工具栏
// ═══════════════════════════════════════════════════════════════
function Toolbar(): React.JSX.Element {
  const { currentRepo, currentBranch, branches, remoteBranches,
        pull, push, refreshAll, refreshAllLocal, operationLoading, checkoutBranch, commitsAhead, commitsBehind } = useAppStore()

    const hasRemote = Boolean(currentRepo?.remoteType && currentRepo.remoteType !== 'none')
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
    const branchMenuItems: MenuProps['items'] = mergedBranches.length === 0
      ? [{ key: '__empty', label: '无分支', disabled: true }]
      : mergedBranches.map((b) => {
        const isRemoteOnly = remoteOnlyBranches.some(rb => rb.name === b.name)
        return {
          key: b.name,
          label: (
            <div className="ig-branch-menu-item">
              <span>{b.isHead ? <CheckOutlined /> : <BranchesOutlined />}</span>
              <span className="ig-branch-name">{b.name}</span>
              {isRemoteOnly && <Tag color="blue">远程</Tag>}
              {!isRemoteOnly && b.name !== currentBranch && <Tag>本地</Tag>}
            </div>
          )
        }
      })
    return (
                    <header className="ig-toolbar" id="main-toolbar">
            <div className="ig-toolbar-left">
              <div className="ig-topbar-logo">IntelliGit</div>
              <span className="ig-toolbar-repo-name">
                {currentRepo ? currentRepo.name : '未选择仓库'}
              </span>
              {currentBranch && (
            <Dropdown
              menu={{
                items: branchMenuItems,
                onClick: ({ key }) => {
                  if (key !== '__empty') checkoutBranch(String(key))
                }
              }}
              trigger={['click']}
            >
              <Button className="ig-branch-picker" size="small" icon={<BranchesOutlined />}>
                {currentBranch}
              </Button>
            </Dropdown>
          )}
          <div className="ig-command-placeholder">
            <ThunderboltOutlined />
            <span>告诉我你想做什么... (Ctrl K)</span>
          </div>
      </div>
            <div className="ig-toolbar-actions">
        <Button
          size="small"
          onClick={hasRemote ? refreshAll : refreshAllLocal}
          disabled={!currentRepo || !!operationLoading}
        >
          {hasRemote ? 'Fetch' : '刷新'}
        </Button>
        {hasRemote && (
          <Button
            type={hasCommitsToPush ? 'primary' : 'default'}
            size="small"
            icon={hasCommitsToPush ? <CloudUploadOutlined /> : <CloudDownloadOutlined />}
            onClick={hasCommitsToPush ? push : pull}
            disabled={!currentRepo || !!operationLoading}
            loading={operationLoading === 'push' || operationLoading === 'pull'}
            title={hasCommitsToPush ? "Push commits" : "Pull commits"}
          >
            {hasCommitsToPush ? `Push ${commitsAhead}` : hasCommitsToPull ? `Pull ${commitsBehind}` : 'Pull'}
          </Button>
        )}
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
  const [runSandbox, setRunSandbox] = useState(false)

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
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一个仓库开始" />
        <p>从左侧缩略图栏添加或选择 Git 仓库</p>
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
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无暂存文件" />
            ) : staged.map(f => (
              <div key={`s-${f.path}`}
                className={`ig-file-item ${selectedFilePath === f.path ? 'active' : ''}`}
                onClick={() => selectFile(f.path)}>
                <span className="ig-file-status-badge" style={{ color: statusColor(f.staging) }}>{statusLabel(f.staging)}</span>
                <span className="ig-file-path">{f.path}</span>
                <Tooltip title="取消暂存">
                  <Button
                    type="text"
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={(e) => { e.stopPropagation(); removeFile(f.path) }}
                  />
                </Tooltip>
              </div>
            ))}
          </div>
        </div>
        <div className="ig-file-section">
          <div className="ig-file-section-header">
            <h3>未暂存 ({unstaged.length})</h3>
            <Button size="small" type="link" onClick={addAll}
              disabled={unstaged.length === 0 || !!operationLoading}>全部暂存</Button>
          </div>
          <div className="ig-file-list">
            {unstaged.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="工作区干净" />
            ) : unstaged.map(f => (
              <div key={`u-${f.path}`}
                className={`ig-file-item ${selectedFilePath === f.path ? 'active' : ''}`}
                onClick={() => selectFile(f.path)}>
                <span className="ig-file-status-badge" style={{ color: statusColor(f.worktree || f.staging) }}>{statusLabel(f.worktree || f.staging)}</span>
                <span className="ig-file-path">{f.path}</span>
                <Tooltip title="暂存">
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={(e) => { e.stopPropagation(); addFile(f.path) }}
                  />
                </Tooltip>
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
        <Button className="ig-ai-btn" icon={<ThunderboltOutlined />} disabled title="AI 生成提交信息（即将推出）">
          AI 生成提交信息
        </Button>
        <TextArea id="commit-message" className="ig-commit-input"
          placeholder="输入提交信息…" value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)} rows={3} />
        <div className="ig-sandbox-row">
          <Switch size="small" checked={runSandbox} onChange={setRunSandbox} />
          <span>提交前运行沙箱验证</span>
        </div>
        <Button id="btn-commit" className="ig-commit-btn" type="primary"
          onClick={handleCommit}
          disabled={!commitMsg.trim() || staged.length === 0 || !!operationLoading}
          loading={operationLoading === 'commit'}>
          {`提交 (${staged.length} 个文件已暂存)`}
        </Button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
//  历史视图（参照 intelligit_branch_graph.html）
// ═══════════════════════════════════════════════════════════════
const GRAPH_COLORS = ['#185fa5', '#1d9e75', '#7c5cc4', '#ba7517', '#e24b4a', '#6f7c12', '#2387a8', '#546179']

function HistoryView(): React.JSX.Element {
    const { allCommitHistory, branches, remoteBranches, currentBranch, currentRepo,
    selectedCommit, selectedCommitFiles, selectCommit,
    fetchAllHistory, checkoutCommit, resetToCommit, operationLoading } = useAppStore()
  const [branchFilter, setBranchFilter] = useState('')
  const [resetMode, setResetMode] = useState<'soft' | 'mixed' | 'hard'>('mixed')
  const [showResetConfirm, setShowResetConfirm] = useState(false)

    useEffect(() => { if (currentRepo) fetchAllHistory() }, [currentRepo, fetchAllHistory])

  // ── 自动选中当前 HEAD commit ──
  // 当历史数据加载完成或分支切换时，自动定位到当前分支的 HEAD commit
  useEffect(() => {
    if (!currentRepo || allCommitHistory.length === 0) return

    // 查找 HEAD commit：refs 包含当前分支名
    const headCommit = allCommitHistory.find(c =>
      c.refs && c.refs.includes(currentBranch)
    )
    if (headCommit && (!selectedCommit || headCommit.hash !== selectedCommit.hash)) {
      selectCommit(headCommit)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRepo, currentBranch, allCommitHistory])

  if (!currentRepo) return <div className="ig-empty-view"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择仓库查看历史" /></div>

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
        <Input className="ig-branch-search" placeholder="搜索分支…"
          value={branchFilter} onChange={e => setBranchFilter(e.target.value)} />
        <div className="ig-branch-list">
          {filtered.map(b => (
            <div key={b.name} className={`ig-branch-item ${b.isHead ? 'current' : ''}`}>
              <span className="ig-branch-dot" style={{background: b.isRemote ? 'var(--accent-orange)' : 'var(--accent-green)'}} />
              <span className="ig-branch-name">{b.name}</span>
              {b.isHead && <Tag color="blue">HEAD</Tag>}
            </div>
          ))}
        </div>
      </div>

      {/* 中间 Commit Graph */}
      <div className="ig-graph-area">
        <div className="ig-graph-header"><h3>Commit Graph ({allCommitHistory.length})</h3></div>
        <div className="ig-graph-list">
          {allCommitHistory.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无提交记录" />
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
                      <Tag key={r} color="blue">{r}</Tag>
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
                <Button onClick={() => checkoutCommit(selectedCommit.hash)}
                  disabled={!!operationLoading} icon={<BranchesOutlined />}>
                  Checkout 到此 Commit
                </Button>
                <Button danger onClick={() => setShowResetConfirm(true)}
                  disabled={!!operationLoading}>
                  Reset 到此 Commit
                </Button>
              </div>
              {showResetConfirm && (
                <div className="ig-reset-confirm">
                  <div className="ig-reset-label">Reset 模式:</div>
                  <Select
                    value={resetMode}
                    onChange={setResetMode}
                    options={[
                      { value: 'soft', label: '--soft' },
                      { value: 'mixed', label: '--mixed' },
                      { value: 'hard', label: '--hard' }
                    ]}
                  />
                  <div className="ig-reset-btns">
                    <Button danger
                      onClick={async () => { await resetToCommit(selectedCommit.hash, resetMode); setShowResetConfirm(false) }}>
                      确认 Reset
                    </Button>
                    <Button onClick={() => setShowResetConfirm(false)}>取消</Button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="ig-detail-empty">选择 commit 查看详情</div>
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
    return <div className="ig-empty-view"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择仓库进行设置" /></div>
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
          <Input value={commitAuthorName} onChange={e => setCommitAuthorName(e.target.value)}
            placeholder="留空时使用 Git 配置或认证用户名" />
        </div>
        <div className="ig-form-group">
          <label>作者邮箱</label>
          <Input value={commitAuthorEmail} onChange={e => setCommitAuthorEmail(e.target.value)}
            placeholder="your-email@example.com" />
        </div>
      </div>
      <div className="ig-settings-section">
        <h3>远程仓库</h3>
        <p className="ig-hint">选择远程仓库形式以配置 Push/Pull 等操作使用的远程地址与认证</p>
        <Segmented
          className="ig-remote-type-group"
          block
          value={remoteType}
          onChange={(value) => handleRemoteTypeChange(value as 'none' | 'http' | 'ssh')}
          options={[
            { value: 'none', label: '无' },
            { value: 'http', label: 'HTTP(S)' },
            { value: 'ssh', label: 'SSH' }
          ]}
        />
        {remoteType !== 'none' && (
          <div className="ig-remote-detail">
                        {remoteType === 'http' && (
              <div className="ig-form-group">
                <label>HTTP(S) 远程地址</label>
                <Input
                  value={httpRemoteUrl}
                  onChange={e => setHttpRemoteUrl(e.target.value)}
                  placeholder="https://github.com/user/repo.git"
                />
              </div>
            )}
            {remoteType === 'ssh' && (
              <div className="ig-form-group">
                <label>SSH 远程地址</label>
                <Input
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
                  <Input value={username} onChange={e => setUsername(e.target.value)}
                    placeholder="用户名" />
                </div>
                <div className="ig-form-group">
                  <label>密码 / Token</label>
                  <Input.Password value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="口令" />
                </div>
              </>
            )}
            {remoteType === 'ssh' && (
              <>
                <p className="ig-hint">SSH 认证</p>
                <div className="ig-form-group">
                  <label>SSH 密钥路径</label>
                  <Input value={sshKeyPath} onChange={e => setSshKeyPath(e.target.value)}
                    placeholder="~/.ssh/id_rsa" />
                </div>
                <div className="ig-form-group">
                  <label>SSH 密钥密码</label>
                  <Input.Password value={sshPassword} onChange={e => setSshPassword(e.target.value)}
                    placeholder="（可选）" />
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <Button type="primary" onClick={handleSave}>保存设置</Button>
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
      <Alert
        className="ig-notification"
        type="error"
        showIcon
        closable
        message={error}
        onClose={clearError}
      />
    )
  }
  if (successMessage) {
    return (
      <Alert
        className="ig-notification"
        type="success"
        showIcon
        closable
        message={successMessage}
        onClose={clearSuccess}
      />
    )
  }
  return null
}

function StatusBar(): React.JSX.Element {
  const { currentRepo, currentBranch, commitsAhead, commitsBehind, operationLoading } = useAppStore()

  return (
    <footer className="ig-statusbar">
      <span className="ig-status-item"><span className="ig-status-dot green" />引擎就绪</span>
      <span className="ig-status-item"><span className="ig-status-dot blue" />API 已连接</span>
      <span className="ig-status-path">{currentRepo ? currentRepo.path : '未选择仓库'}</span>
      <span className="ig-status-tail">
        {operationLoading ? `正在执行 ${operationLoading}` : `${commitsAhead}↑ ${commitsBehind}↓`}
        {currentBranch ? ` · ${currentBranch}` : ''}
      </span>
    </footer>
  )
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
  const [themeMode, setThemeMode] = useState<AppThemeMode>(() => {
    const saved = window.localStorage.getItem('intelligit.theme')
    return saved === 'light' || saved === 'dark' ? saved : 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    document.body.dataset.theme = themeMode
    window.localStorage.setItem('intelligit.theme', themeMode)
  }, [themeMode])

    const toggleTheme = useCallback(() => {
    setThemeMode((mode) => mode === 'dark' ? 'light' : 'dark')
  }, [])

  const [repoPanelOpen, setRepoPanelOpen] = useState(false)
  const toggleRepoPanel = useCallback(() => {
    setRepoPanelOpen((prev) => !prev)
  }, [])

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
  }, [currentRepo, refreshAllLocal])

  if (!configLoaded) {
    return (
      <ConfigProvider theme={ANT_THEME_TOKENS[themeMode]}>
        <AntApp>
          <div className="ig-loading-screen">
            <Spin size="large" />
            <p>加载中…</p>
          </div>
        </AntApp>
      </ConfigProvider>
    )
  }

  return (
    <ConfigProvider theme={ANT_THEME_TOKENS[themeMode]}>
      <AntApp className="ig-ant-root">
        <div className={`ig-app theme-${themeMode}`}>
          <Toolbar />
          <NotificationBar />
          {loading && currentRepo && (
            <div className="ig-loading-bar"><div className="ig-loading-bar-inner" /></div>
          )}
          <div className="ig-workbench">
                      <ActivityRail themeMode={themeMode} onToggleTheme={toggleTheme} repoPanelOpen={repoPanelOpen} onToggleRepoPanel={toggleRepoPanel} />
                      <RepoPanel isOpen={repoPanelOpen} onClose={toggleRepoPanel} />
                      <main className="ig-content">
              {activeView === 'changes' && <ChangesView />}
              {activeView === 'history' && <HistoryView />}
              {activeView === 'settings' && <SettingsView key={currentRepo?.path || 'settings'} />}
            </main>
          </div>
          <StatusBar />
        </div>
      </AntApp>
    </ConfigProvider>
  )
}

export default MainApp
