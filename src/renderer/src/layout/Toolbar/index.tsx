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

import { refreshAll, refreshAllLocal } from '../../services/refreshCoordinator'
import { checkoutBranch, pull, push } from '../../services/gitWorkflowService'
import { useToolbarModel } from '../../viewModels'

function Toolbar(): JSX.Element {
  const {
    currentRepo,
    currentBranch,
    branchOptions,
    operationLoading,
    hasRemote,
    hasCommitsToPush,
    hasCommitsToPull,
    commitsAhead,
    commitsBehind,
    isBusy
  } = useToolbarModel()

  const branchMenuItems: MenuProps['items'] =
    branchOptions.length === 0
      ? [{ key: '__empty', label: '无分支', disabled: true }]
      : branchOptions.map((branch) => {
          return {
            key: branch.name,
            label: (
              <div className="ig-branch-menu-item">
                <span>{branch.isHead ? <CheckOutlined /> : <BranchesOutlined />}</span>
                <span className="ig-branch-name">{branch.name}</span>
                {branch.isRemoteOnly && <Tag color="blue">远程</Tag>}
                {!branch.isRemoteOnly && branch.name !== currentBranch && <Tag>本地</Tag>}
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
          disabled={!currentRepo || isBusy}
        >
          {hasRemote ? 'Fetch' : '刷新'}
        </Button>
        {hasRemote && (
          <Button
            type={hasCommitsToPush ? 'primary' : 'default'}
            size="small"
            icon={hasCommitsToPush ? <CloudUploadOutlined /> : <CloudDownloadOutlined />}
            onClick={hasCommitsToPush ? push : pull}
            disabled={!currentRepo || isBusy}
            loading={operationLoading === 'remote.push' || operationLoading === 'remote.pull'}
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
