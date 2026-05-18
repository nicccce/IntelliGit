import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { ThunderboltOutlined } from '@ant-design/icons'
import { Button, Input, Tooltip } from 'antd'

import { createCommit } from '../../services/gitWorkflowService'
import styles from './CommitPanel.module.css'

const { TextArea } = Input

interface CommitPanelProps {
  stagedCount: number
  isBusy: boolean
  isCommitRunning: boolean
}

function CommitPanel({ stagedCount, isBusy, isCommitRunning }: CommitPanelProps): JSX.Element {
  const [commitMsg, setCommitMsg] = useState('')

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) return
    await createCommit(commitMsg.trim())
    setCommitMsg('')
  }, [commitMsg])

  return (
    <div className={styles['ig-commit-panel']}>
      <div className={styles['ig-input-wrapper']}>
        <TextArea
          id="commit-message"
          className={styles['ig-commit-input']}
          placeholder="输入提交信息…"
          value={commitMsg}
          onChange={(event) => setCommitMsg(event.target.value)}
          rows={3}
        />
        <Tooltip title="AI 生成提交信息（即将推出）">
          <Button
            className={styles['ig-ai-btn']}
            icon={<ThunderboltOutlined />}
            disabled
            type="text"
          />
        </Tooltip>
      </div>
      <Button
        id="btn-commit"
        className={styles['ig-commit-btn']}
        type="primary"
        onClick={handleCommit}
        disabled={!commitMsg.trim() || stagedCount === 0 || isBusy}
        loading={isCommitRunning}
      >
        {`提交 (${stagedCount} 个文件已暂存)`}
      </Button>
    </div>
  )
}

export default CommitPanel
