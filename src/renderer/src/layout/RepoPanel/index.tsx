import type { JSX, MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useState } from 'react'
import { Alert, Button, Dropdown, Input, Modal, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import {
  CheckOutlined,
  CloseOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  PlusOutlined
} from '@ant-design/icons'

import RepoAvatar from '../../components/RepoAvatar'
import { checkDirEmpty, checkDirExists, openFolderDialog } from '../../api/filesystemClient'
import { isGitRepository } from '../../services/repositoryService'
import { useRepositoryStore } from '../../store'

interface RepoPanelProps {
  isOpen: boolean
  onClose: () => void
}

function RepoPanel({ isOpen, onClose }: RepoPanelProps): JSX.Element {
  const repos = useRepositoryStore((state) => state.repos)
  const currentRepo = useRepositoryStore((state) => state.currentRepo)
  const switchRepo = useRepositoryStore((state) => state.switchRepo)
  const addRepo = useRepositoryStore((state) => state.addRepo)
  const createRepo = useRepositoryStore((state) => state.createRepo)
  const cloneRepo = useRepositoryStore((state) => state.cloneRepo)
  const removeRepo = useRepositoryStore((state) => state.removeRepo)

  const [panelWidth, setPanelWidth] = useState(280)
  const [repoToRemove, setRepoToRemove] = useState<{ path: string; name: string } | null>(null)
  const [removingRepo, setRemovingRepo] = useState(false)
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

  const handleResizeMouseDown = useCallback((event: ReactMouseEvent): void => {
    const minPanelWidth = 200
    const maxPanelWidth = 520

    event.preventDefault()
    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (moveEvent: MouseEvent): void => {
      const newWidth = Math.max(minPanelWidth, Math.min(maxPanelWidth, moveEvent.clientX - 52))
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
    const path = await openFolderDialog()
    if (!path) return

    setCreateLocation(path)
    const exists = await checkDirExists(path)
    setCreateLocationExists(exists)
    if (exists) {
      setCreateLocationIsRepo(await isGitRepository(path))
    } else {
      setCreateLocationIsRepo(null)
    }
  }, [])

  const handleChooseCloneLocation = useCallback(async () => {
    const path = await openFolderDialog()
    if (!path) return

    setCloneLocation(path)
    const exists = await checkDirExists(path)
    const isEmpty = await checkDirEmpty(path)
    setCloneLocationExists(exists)
    setCloneLocationIsEmpty(isEmpty)
  }, [])

  const handleCreateLocationChange = useCallback(async (value: string) => {
    setCreateLocation(value)
    if (!value.trim()) {
      setCreateLocationExists(null)
      setCreateLocationIsRepo(null)
      return
    }

    const pathValue = value.trim()
    const exists = await checkDirExists(pathValue)
    setCreateLocationExists(exists)
    if (exists) {
      setCreateLocationIsRepo(await isGitRepository(pathValue))
    } else {
      setCreateLocationIsRepo(null)
    }
  }, [])

  const handleCloneLocationChange = useCallback(async (value: string) => {
    setCloneLocation(value)
    if (!value.trim()) {
      setCloneLocationExists(null)
      setCloneLocationIsEmpty(null)
      return
    }

    const exists = await checkDirExists(value.trim())
    const isEmpty = await checkDirEmpty(value.trim())
    setCloneLocationExists(exists)
    setCloneLocationIsEmpty(isEmpty)
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

    setLoadingAction(true)
    try {
      const result = await createRepo(createLocation.trim())
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
  }, [closeModal, createLocation, createLocationExists, createRepo, createRepoName])

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
        isRepo = await isGitRepository(createLocation.trim())
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
  }, [addRepo, closeModal, createLocation, createLocationExists, createLocationIsRepo])

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

    setLoadingAction(true)
    try {
      const result = await cloneRepo(cloneUrl.trim(), cloneLocation.trim())
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
  }, [cloneLocation, cloneLocationExists, cloneLocationIsEmpty, cloneRepo, cloneUrl, closeModal])

  const modalTitle = modal === 'create' ? '创建仓库' : modal === 'add' ? '添加仓库' : '克隆仓库'
  const confirmLabel = modal === 'clone' ? '开始克隆' : modal === 'create' ? '创建' : '添加'
  const confirmDisabled =
    loadingAction ||
    (modal === 'add' && !createLocation.trim()) ||
    (modal === 'create' && (!createRepoName.trim() || !createLocation.trim())) ||
    (modal === 'clone' && (!cloneUrl.trim() || !cloneLocation.trim()))
  const handleConfirm =
    modal === 'add'
      ? handleAddConfirm
      : modal === 'create'
        ? handleCreateConfirm
        : handleCloneConfirm

  return (
    <>
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
          <Dropdown
            menu={{ items: repoMenuItems, onClick: handleRepoMenuClick }}
            trigger={['click']}
            placement="bottomLeft"
          >
            <Button className="ig-panel-add-btn" block icon={<PlusOutlined />}>
              添加仓库
            </Button>
          </Dropdown>
          <div className="ig-panel-repo-list">
            {repos.length === 0 ? (
              <div className="ig-panel-empty">暂无仓库，点击上方按钮添加</div>
            ) : (
              repos.map((repo) => (
                <Dropdown
                  key={repo.path}
                  menu={{
                    items: [
                      {
                        key: 'remove',
                        icon: <DeleteOutlined />,
                        label: '删除仓库',
                        danger: true,
                        onClick: () => setRepoToRemove({ path: repo.path, name: repo.name })
                      }
                    ]
                  }}
                  trigger={['contextMenu']}
                >
                  <div
                    className={`ig-panel-repo-item ${currentRepo?.path === repo.path ? 'active' : ''}`}
                    onClick={() => switchRepo(repo.path)}
                  >
                    <RepoAvatar name={repo.name} />
                    <div className="ig-repo-info">
                      <strong>{repo.name}</strong>
                      <small>{repo.path}</small>
                    </div>
                    <div className="ig-repo-actions">
                      {currentRepo?.path === repo.path && (
                        <CheckOutlined className="ig-repo-check" />
                      )}
                      <Tooltip title="删除仓库（仅移除列表，不删除本地文件）">
                        <Button
                          type="text"
                          size="small"
                          className="ig-repo-delete-btn"
                          icon={<CloseOutlined />}
                          onClick={(event) => {
                            event.stopPropagation()
                            setRepoToRemove({ path: repo.path, name: repo.name })
                          }}
                        />
                      </Tooltip>
                    </div>
                  </div>
                </Dropdown>
              ))
            )}
          </div>
        </div>
      </aside>

      <Modal
        open={!!modal}
        title={modalTitle}
        onCancel={closeModal}
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={closeModal}>
            取消
          </Button>,
          <Button
            key="ok"
            type="primary"
            loading={loadingAction}
            disabled={confirmDisabled}
            onClick={handleConfirm}
          >
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
                  onChange={(event) => setCreateRepoName(event.target.value)}
                  placeholder="请输入仓库名称"
                />
              </div>
              <div className="ig-form-group">
                <label>存储位置</label>
                <Input.Search
                  value={createLocation}
                  onChange={(event) => handleCreateLocationChange(event.target.value)}
                  onSearch={handleChooseCreateLocation}
                  enterButton="选择"
                  placeholder="请输入或选择仓库位置"
                />
                {createLocation.trim() && (
                  <Alert
                    className="ig-path-alert"
                    type={
                      createLocationExists === true
                        ? 'success'
                        : createLocationExists === false
                          ? 'error'
                          : 'info'
                    }
                    showIcon
                    message={
                      createLocationExists === true
                        ? '目录存在'
                        : createLocationExists === false
                          ? '目录不存在'
                          : '检查中...'
                    }
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
                onChange={(event) => handleCreateLocationChange(event.target.value)}
                onSearch={handleChooseCreateLocation}
                enterButton="选择"
                placeholder="请输入或选择现有仓库路径"
              />
              {createLocation.trim() && (
                <Alert
                  className="ig-path-alert"
                  type={
                    createLocationExists === true
                      ? 'success'
                      : createLocationExists === false
                        ? 'error'
                        : 'info'
                  }
                  showIcon
                  message={
                    createLocationExists === true
                      ? '目录存在'
                      : createLocationExists === false
                        ? '目录不存在'
                        : '检查中...'
                  }
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
                  onChange={(event) => setCloneUrl(event.target.value)}
                  placeholder="https://github.com/user/repo.git"
                />
              </div>
              <div className="ig-form-group">
                <label>克隆位置</label>
                <Input.Search
                  value={cloneLocation}
                  onChange={(event) => handleCloneLocationChange(event.target.value)}
                  onSearch={handleChooseCloneLocation}
                  enterButton="选择"
                  placeholder="请输入或选择空目录作为克隆位置"
                />
                {cloneLocation.trim() && (
                  <Alert
                    className="ig-path-alert"
                    type={
                      cloneLocationExists === true && cloneLocationIsEmpty === true
                        ? 'success'
                        : cloneLocationExists === false || cloneLocationIsEmpty === false
                          ? 'error'
                          : 'info'
                    }
                    showIcon
                    message={
                      cloneLocationExists === true && cloneLocationIsEmpty === true
                        ? '目录存在，且为空目录'
                        : cloneLocationExists === true && cloneLocationIsEmpty === false
                          ? '目录存在，但不为空目录'
                          : cloneLocationExists === false
                            ? '目录不存在'
                            : '检查中...'
                    }
                  />
                )}
              </div>
            </>
          )}
          {modalError && <Alert type="error" showIcon message={modalError} />}
        </div>
      </Modal>

      <Modal
        open={!!repoToRemove}
        title="删除仓库"
        onCancel={() => setRepoToRemove(null)}
        destroyOnHidden
        footer={[
          <Button key="cancel" onClick={() => setRepoToRemove(null)}>
            取消
          </Button>,
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

export default RepoPanel
