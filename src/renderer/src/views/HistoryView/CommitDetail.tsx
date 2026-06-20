import type { JSX } from 'react'
import { useState } from 'react'
import { BranchesOutlined } from '@ant-design/icons'
import { Button, Select } from 'antd'

import type { CommitRecord, DiffEntry, ResetMode } from '../../../../shared/types'
import { checkoutBranch, checkoutCommit, resetToCommit } from '../../services/gitWorkflowService'
import styles from './CommitDetail.module.css'

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
    return <div className={styles['ig-detail-empty']}>选择 commit 查看详情</div>
  }

  return (
    <>
      <div className={styles['ig-detail-hdr']}>
        <h3>Commit 详情</h3>
      </div>
      <div className={styles['ig-detail-body']}>
        <div className={styles['ig-detail-hash']}>
          <code>{selectedCommit.hash}</code>
        </div>
        <div className={styles['ig-detail-msg']}>{selectedCommit.message}</div>
        <div className={styles['ig-detail-meta']}>
          <span>{selectedCommit.author}</span>
          <span>{new Date(selectedCommit.date).toLocaleString('zh-CN')}</span>
        </div>
        {selectedCommitFiles.length > 0 && (
          <div className={styles['ig-detail-files']}>
            <div className={styles['ig-detail-files-hdr']}>
              变更文件 ({selectedCommitFiles.length})
            </div>
            {selectedCommitFiles.map((file, fileIndex) => (
              <div key={fileIndex} className={styles['ig-detail-file']}>
                <span
                  className={styles['ig-file-status']}
                  style={{ color: fileActionColor(file.action) }}
                >
                  {fileActionLabel(file.action)}
                </span>
                <span>{file.to || file.from}</span>
              </div>
            ))}
          </div>
        )}
        <div className={styles['ig-detail-actions']}>
          <Button
            onClick={() => {
              // 优先 checkout 本地分支（避免 detached HEAD）
              const localBranch = selectedCommit.refs?.find(
                (r) => !r.startsWith('origin/') && r !== 'HEAD'
              )
              if (localBranch) {
                checkoutBranch(localBranch)
              } else {
                checkoutCommit(selectedCommit.hash)
              }
            }}
            disabled={isBusy}
            icon={<BranchesOutlined />}
          >
            {selectedCommit.refs?.some((r) => !r.startsWith('origin/') && r !== 'HEAD')
              ? `Checkout 到 ${selectedCommit.refs.find((r) => !r.startsWith('origin/') && r !== 'HEAD')}`
              : 'Checkout 到此 Commit'}
          </Button>
          <Button danger onClick={() => setShowResetConfirm(true)} disabled={isBusy}>
            Reset 到此 Commit
          </Button>
        </div>
        {showResetConfirm && (
          <div className={styles['ig-reset-confirm']}>
            <div className={styles['ig-reset-label']}>Reset 模式:</div>
            <Select
              value={resetMode}
              onChange={setResetMode}
              options={[
                { value: 'soft', label: '--soft' },
                { value: 'mixed', label: '--mixed' },
                { value: 'hard', label: '--hard' }
              ]}
            />
            <div className={styles['ig-reset-btns']}>
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
