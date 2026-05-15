import type { JSX } from 'react'
import { useState } from 'react'
import { Input, Tag } from 'antd'

import type { BranchInfo } from '../../../../shared/types'
import { classNames } from '../../utils/classNames'
import styles from './BranchPanel.module.css'

interface BranchPanelProps {
  branches: BranchInfo[]
}

function BranchPanel({ branches }: BranchPanelProps): JSX.Element {
  const [branchFilter, setBranchFilter] = useState('')
  const filteredBranches = branches.filter(
    (branch) => !branchFilter || branch.name.toLowerCase().includes(branchFilter.toLowerCase())
  )

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
            className={classNames(styles['ig-branch-item'], branch.isHead && styles.current)}
          >
            <span
              className={styles['ig-branch-dot']}
              style={{
                background: branch.isRemote ? 'var(--accent-orange)' : 'var(--accent-green)'
              }}
            />
            <span className={styles['ig-branch-name']}>{branch.name}</span>
            {branch.isHead && <Tag color="blue">HEAD</Tag>}
          </div>
        ))}
      </div>
    </div>
  )
}

export default BranchPanel
