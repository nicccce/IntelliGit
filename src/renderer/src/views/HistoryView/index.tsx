import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { BranchesOutlined } from '@ant-design/icons'
import { Button, Empty, Input, Select, Tag } from 'antd'

import { checkoutCommit, resetToCommit } from '../../services/gitWorkflowService'
import {
  useGitStatusStore,
  useHistoryStore,
  useOperationStore,
  useRepositoryStore
} from '../../store'

const GRAPH_COLORS = [
  '#185fa5',
  '#1d9e75',
  '#7c5cc4',
  '#ba7517',
  '#e24b4a',
  '#6f7c12',
  '#2387a8',
  '#546179'
]

function HistoryView(): JSX.Element {
  const allCommitHistory = useHistoryStore((state) => state.allCommitHistory)
  const branches = useGitStatusStore((state) => state.branches)
  const remoteBranches = useGitStatusStore((state) => state.remoteBranches)
  const currentBranch = useGitStatusStore((state) => state.currentBranch)
  const currentRepo = useRepositoryStore((state) => state.currentRepo)
  const selectedCommit = useHistoryStore((state) => state.selectedCommit)
  const selectedCommitFiles = useHistoryStore((state) => state.selectedCommitFiles)
  const selectCommit = useHistoryStore((state) => state.selectCommit)
  const fetchAllHistory = useHistoryStore((state) => state.fetchAllHistory)
  const operationLoading = useOperationStore((state) => state.operationLoading)

  const [branchFilter, setBranchFilter] = useState('')
  const [resetMode, setResetMode] = useState<'soft' | 'mixed' | 'hard'>('mixed')
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  useEffect(() => {
    if (currentRepo) fetchAllHistory()
  }, [currentRepo, fetchAllHistory])

  useEffect(() => {
    if (!currentRepo || allCommitHistory.length === 0) return

    const headCommit = allCommitHistory.find(
      (commit) => commit.refs && commit.refs.includes(currentBranch)
    )
    if (headCommit && (!selectedCommit || headCommit.hash !== selectedCommit.hash)) {
      selectCommit(headCommit)
    }
  }, [allCommitHistory, currentBranch, currentRepo, selectCommit, selectedCommit])

  if (!currentRepo) {
    return (
      <div className="ig-empty-view">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择仓库查看历史" />
      </div>
    )
  }

  const allBranches = [...branches, ...remoteBranches]
  const filteredBranches = allBranches.filter(
    (branch) => !branchFilter || branch.name.toLowerCase().includes(branchFilter.toLowerCase())
  )

  const laneMap = new Map<string, number>()
  let nextLane = 0
  allCommitHistory.forEach((commit) => {
    if (!laneMap.has(commit.hash)) {
      const refLane =
        commit.refs && commit.refs.length > 0
          ? commit.refs[0]
          : commit.parentHashes?.[0] || commit.hash
      if (!laneMap.has(refLane)) laneMap.set(refLane, nextLane++ % GRAPH_COLORS.length)
      laneMap.set(commit.hash, laneMap.get(refLane) || 0)
    }
  })

  return (
    <div className="ig-history-view" id="history-view">
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

      <div className="ig-graph-area">
        <div className="ig-graph-header">
          <h3>Commit Graph ({allCommitHistory.length})</h3>
        </div>
        <div className="ig-graph-list">
          {allCommitHistory.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无提交记录" />
          ) : (
            allCommitHistory.map((commit) => {
              const lane = laneMap.get(commit.hash) || 0
              const color = GRAPH_COLORS[lane % GRAPH_COLORS.length]
              const isMerge = (commit.parentHashes?.length || 0) > 1
              return (
                <div
                  key={commit.hash}
                  className={`ig-graph-row ${selectedCommit?.hash === commit.hash ? 'selected' : ''}`}
                  onClick={() => selectCommit(commit)}
                >
                  <div className="ig-graph-lane">
                    <svg width="20" height="32" viewBox="0 0 20 32">
                      <line
                        x1="10"
                        y1="0"
                        x2="10"
                        y2="32"
                        stroke={color}
                        strokeWidth="2"
                        opacity="0.4"
                      />
                      {isMerge ? (
                        <rect x="4" y="10" width="12" height="12" rx="2" fill={color} />
                      ) : (
                        <circle cx="10" cy="16" r="5" fill={color} />
                      )}
                    </svg>
                  </div>
                  <div className="ig-graph-info">
                    <div className="ig-graph-msg">
                      {commit.message?.split('\n')[0]}
                      {commit.refs &&
                        commit.refs.map((refName) => (
                          <Tag key={refName} color="blue">
                            {refName}
                          </Tag>
                        ))}
                    </div>
                    <div className="ig-graph-meta">
                      <span>{commit.author}</span>
                      <span className="ig-graph-hash">{commit.shortHash}</span>
                      <span>
                        {new Date(commit.date).toLocaleString('zh-CN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div className="ig-detail-panel">
        {selectedCommit ? (
          <>
            <div className="ig-detail-hdr">
              <h3>Commit 详情</h3>
            </div>
            <div className="ig-detail-body">
              <div className="ig-detail-hash">
                <code>{selectedCommit.hash}</code>
              </div>
              <div className="ig-detail-msg">{selectedCommit.message}</div>
              <div className="ig-detail-meta">
                <span>{selectedCommit.author}</span>
                <span>{new Date(selectedCommit.date).toLocaleString('zh-CN')}</span>
              </div>
              {selectedCommitFiles.length > 0 && (
                <div className="ig-detail-files">
                  <div className="ig-detail-files-hdr">变更文件 ({selectedCommitFiles.length})</div>
                  {selectedCommitFiles.map((file, fileIndex) => (
                    <div key={fileIndex} className="ig-detail-file">
                      <span
                        className="ig-file-status"
                        style={{
                          color:
                            file.action === 'insert'
                              ? 'var(--accent-green)'
                              : file.action === 'delete'
                                ? 'var(--accent-red)'
                                : 'var(--accent-blue)'
                        }}
                      >
                        {file.action === 'insert' ? 'A' : file.action === 'delete' ? 'D' : 'M'}
                      </span>
                      <span>{file.to || file.from}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="ig-detail-actions">
                <Button
                  onClick={() => checkoutCommit(selectedCommit.hash)}
                  disabled={!!operationLoading}
                  icon={<BranchesOutlined />}
                >
                  Checkout 到此 Commit
                </Button>
                <Button
                  danger
                  onClick={() => setShowResetConfirm(true)}
                  disabled={!!operationLoading}
                >
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
                    <Button
                      danger
                      onClick={async () => {
                        await resetToCommit(selectedCommit.hash, resetMode)
                        setShowResetConfirm(false)
                      }}
                    >
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

export default HistoryView
