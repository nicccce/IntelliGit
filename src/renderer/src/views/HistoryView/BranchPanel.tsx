import type { JSX } from 'react'
import { useState } from 'react'
import { Input, Tag, Tooltip } from 'antd'

import type { BranchInfo } from '../../../../shared/types'
import { useShadowMergeStore } from '../../store/shadowMergeStore'
import { classNames } from '../../utils/classNames'
import styles from './BranchPanel.module.css'

interface BranchPanelProps {
  branches: BranchInfo[]
  currentBranch: string
  onSelectBranch: (branchName: string) => void
}

function ShadowBadge({ branchName, isHead }: { branchName: string; isHead: boolean }): JSX.Element | null {
  const branchResults = useShadowMergeStore((s) => s.branchResults)
  const checkBranch = useShadowMergeStore((s) => s.checkBranch)

  if (isHead) return null

  const state = branchResults[branchName]

  if (!state || state.status === 'idle') {
    return (
      <Tooltip title="点击预检合并冲突">
        <span
          className={classNames(styles['ig-shadow-badge'], styles['pending'])}
          onClick={(e) => {
            e.stopPropagation()
            checkBranch(branchName)
          }}
        />
      </Tooltip>
    )
  }

  if (state.status === 'pending') {
    return (
      <Tooltip title="预检中…">
        <span className={classNames(styles['ig-shadow-badge'], styles['pending'])} />
      </Tooltip>
    )
  }

  if (state.status === 'error') {
    return (
      <Tooltip title="预检失败">
        <span className={classNames(styles['ig-shadow-badge'], styles['pending'])} />
      </Tooltip>
    )
  }

  const result = state.result!

  if (result.canFastForward) {
    return (
      <Tooltip title="可快进合并，无冲突">
        <span className={classNames(styles['ig-shadow-badge'], styles['fastforward'])} />
      </Tooltip>
    )
  }

  if (result.hasConflicts) {
    const tip = result.conflictedFiles?.length
      ? `存在 ${result.conflictedFiles.length} 个冲突文件：${result.conflictedFiles.slice(0, 3).join('、')}${result.conflictedFiles.length > 3 ? '…' : ''}`
      : '存在合并冲突'
    return (
      <Tooltip title={tip}>
        <span className={classNames(styles['ig-shadow-badge'], styles['conflict'])} />
      </Tooltip>
    )
  }

  return (
    <Tooltip title="可安全合并">
      <span className={classNames(styles['ig-shadow-badge'], styles['safe'])} />
    </Tooltip>
  )
}

function BranchPanel({ branches, currentBranch, onSelectBranch }: BranchPanelProps): JSX.Element {
  const [branchFilter, setBranchFilter] = useState('')
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null)

  const filteredBranches = branches.filter(
    (branch) => !branchFilter || branch.name.toLowerCase().includes(branchFilter.toLowerCase())
  )

  const handleClick = (branchName: string) => {
    setSelectedBranch(branchName)
    onSelectBranch(branchName)
  }

  return (
    <div className={styles['ig-branch-panel']}>
      <div className={styles['ig-branch-panel-hdr']}>
        <h3>分支</h3>
      </div>
      <Input
        className={styles['ig-branch-search']}
        placeholder="搜索分支…"
        value={branchFilter}
        onChange={(event) => setBranchFilter(event.target.value)}
      />
      <div className={styles['ig-branch-list']}>
        {filteredBranches.map((branch) => (
          <div
            key={branch.name}
            className={classNames(
              styles['ig-branch-item'],
              branch.isHead && styles.current,
              !branch.isHead && branch.name === selectedBranch && styles.selected
            )}
            onClick={() => handleClick(branch.name)}
          >
            <span
              className={styles['ig-branch-dot']}
              style={{
                background: branch.isRemote ? 'var(--accent-orange)' : 'var(--accent-green)'
              }}
            />
            <span className={styles['ig-branch-name']}>{branch.name}</span>
            {branch.isHead && <Tag color="blue">HEAD</Tag>}
            {!branch.isRemote && (
              <ShadowBadge branchName={branch.name} isHead={branch.name === currentBranch} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default BranchPanel
