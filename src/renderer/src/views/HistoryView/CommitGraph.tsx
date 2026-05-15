import type { JSX } from 'react'
import { Empty, Tag } from 'antd'

import type { CommitRecord } from '../../../../shared/types'
import { getCommitLaneColor, isMergeCommit } from '../../utils/commitGraph'

interface CommitGraphProps {
  commits: CommitRecord[]
  laneMap: Map<string, number>
  selectedCommitHash: string | undefined
  onSelectCommit: (commit: CommitRecord) => void
}

function CommitGraph({
  commits,
  laneMap,
  selectedCommitHash,
  onSelectCommit
}: CommitGraphProps): JSX.Element {
  return (
    <div className="ig-graph-area">
      <div className="ig-graph-header">
        <h3>Commit Graph ({commits.length})</h3>
      </div>
      <div className="ig-graph-list">
        {commits.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无提交记录" />
        ) : (
          commits.map((commit) => {
            const color = getCommitLaneColor(laneMap, commit.hash)
            const isMerge = isMergeCommit(commit)

            return (
              <div
                key={commit.hash}
                className={`ig-graph-row ${selectedCommitHash === commit.hash ? 'selected' : ''}`}
                onClick={() => onSelectCommit(commit)}
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
  )
}

export default CommitGraph
