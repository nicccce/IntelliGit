import type { JSX } from 'react'
import { useState } from 'react'
import { Input, Tag } from 'antd'

import type { BranchInfo } from '../../../../shared/types'

interface BranchPanelProps {
  branches: BranchInfo[]
}

function BranchPanel({ branches }: BranchPanelProps): JSX.Element {
  const [branchFilter, setBranchFilter] = useState('')
  const filteredBranches = branches.filter(
    (branch) => !branchFilter || branch.name.toLowerCase().includes(branchFilter.toLowerCase())
  )

  return (
    <div className="ig-branch-panel">
      <div className="ig-branch-panel-hdr">
        <h3>分支</h3>
      </div>
      <Input
        className="ig-branch-search"
        placeholder="搜索分支…"
        value={branchFilter}
        onChange={(event) => setBranchFilter(event.target.value)}
      />
      <div className="ig-branch-list">
        {filteredBranches.map((branch) => (
          <div key={branch.name} className={`ig-branch-item ${branch.isHead ? 'current' : ''}`}>
            <span
              className="ig-branch-dot"
              style={{
                background: branch.isRemote ? 'var(--accent-orange)' : 'var(--accent-green)'
              }}
            />
            <span className="ig-branch-name">{branch.name}</span>
            {branch.isHead && <Tag color="blue">HEAD</Tag>}
          </div>
        ))}
      </div>
    </div>
  )
}

export default BranchPanel
