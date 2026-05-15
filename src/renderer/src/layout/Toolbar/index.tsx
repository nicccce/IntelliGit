import type { JSX } from 'react'
import { Button, Dropdown, Tag } from 'antd'
import type { MenuProps } from 'antd'
import {
  BranchesOutlined,
  CheckOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'

import { useAppStore } from '../../store'

function Toolbar(): JSX.Element {
  const currentRepo = useAppStore((state) => state.currentRepo)
  const currentBranch = useAppStore((state) => state.currentBranch)
  const branches = useAppStore((state) => state.branches)
  const remoteBranches = useAppStore((state) => state.remoteBranches)
  const pull = useAppStore((state) => state.pull)
  const push = useAppStore((state) => state.push)
  const refreshAll = useAppStore((state) => state.refreshAll)
  const refreshAllLocal = useAppStore((state) => state.refreshAllLocal)
  const operationLoading = useAppStore((state) => state.operationLoading)
  const checkoutBranch = useAppStore((state) => state.checkoutBranch)
  const commitsAhead = useAppStore((state) => state.commitsAhead)
  const commitsBehind = useAppStore((state) => state.commitsBehind)

  const hasRemote = Boolean(currentRepo?.remoteType && currentRepo.remoteType !== 'none')
  const hasCommitsToPush = hasRemote && commitsAhead > 0 && commitsBehind === 0
  const hasCommitsToPull = hasRemote && commitsBehind > 0

  const localBranchNames = new Set(branches.map((branch) => branch.name))
  const remoteOnlyBranches = remoteBranches
    .filter((branch) => !localBranchNames.has(branch.name.replace(/^origin\//, '')))
    .map((branch) => ({ ...branch, name: branch.name.replace(/^origin\//, '') }))
  const mergedBranches = [...branches.filter((branch) => !branch.isRemote), ...remoteOnlyBranches]

  const branchMenuItems: MenuProps['items'] =
    mergedBranches.length === 0
      ? [{ key: '__empty', label: '无分支', disabled: true }]
      : mergedBranches.map((branch) => {
          const isRemoteOnly = remoteOnlyBranches.some(
            (remoteBranch) => remoteBranch.name === branch.name
          )
          return {
            key: branch.name,
            label: (
              <div className="ig-branch-menu-item">
                <span>{branch.isHead ? <CheckOutlined /> : <BranchesOutlined />}</span>
                <span className="ig-branch-name">{branch.name}</span>
                {isRemoteOnly && <Tag color="blue">远程</Tag>}
                {!isRemoteOnly && branch.name !== currentBranch && <Tag>本地</Tag>}
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
            title={hasCommitsToPush ? 'Push commits' : 'Pull commits'}
          >
            {hasCommitsToPush
              ? `Push ${commitsAhead}`
              : hasCommitsToPull
                ? `Pull ${commitsBehind}`
                : 'Pull'}
          </Button>
        )}
      </div>
    </header>
  )
}

export default Toolbar
