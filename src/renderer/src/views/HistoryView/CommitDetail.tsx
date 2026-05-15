import type { JSX } from 'react'
import { useState } from 'react'
import { BranchesOutlined } from '@ant-design/icons'
import { Button, Select } from 'antd'

import type { CommitRecord, DiffEntry, ResetMode } from '../../../../shared/types'
import { checkoutCommit, resetToCommit } from '../../services/gitWorkflowService'

interface CommitDetailProps {
  selectedCommit: CommitRecord | null
  selectedCommitFiles: DiffEntry[]
  isBusy: boolean
}

function fileActionColor(action: DiffEntry['action']): string {
  if (action === 'insert') return 'var(--accent-green)'
  if (action === 'delete') return 'var(--accent-red)'
  return 'var(--accent-blue)'
}

function fileActionLabel(action: DiffEntry['action']): string {
  if (action === 'insert') return 'A'
  if (action === 'delete') return 'D'
  return 'M'
}

function CommitDetail({
  selectedCommit,
  selectedCommitFiles,
  isBusy
}: CommitDetailProps): JSX.Element {
  const [resetMode, setResetMode] = useState<ResetMode>('mixed')
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  if (!selectedCommit) {
    return <div className="ig-detail-empty">选择 commit 查看详情</div>
  }

  return (
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
                <span className="ig-file-status" style={{ color: fileActionColor(file.action) }}>
                  {fileActionLabel(file.action)}
                </span>
                <span>{file.to || file.from}</span>
              </div>
            ))}
          </div>
        )}
        <div className="ig-detail-actions">
          <Button
            onClick={() => checkoutCommit(selectedCommit.hash)}
            disabled={isBusy}
            icon={<BranchesOutlined />}
          >
            Checkout 到此 Commit
          </Button>
          <Button danger onClick={() => setShowResetConfirm(true)} disabled={isBusy}>
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
  )
}

export default CommitDetail
