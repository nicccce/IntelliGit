import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { ThunderboltOutlined } from '@ant-design/icons'
import { Button, Input, Tooltip } from 'antd'

import { createCommit } from '../../services/gitWorkflowService'
import { generateSmartCommitMessage } from '../../services/smartCommitService'
import { useUiStore } from '../../store/uiStore'
import styles from './CommitPanel.module.css'

const { TextArea } = Input

interface CommitPanelProps {
  stagedCount: number
  isBusy: boolean
  isCommitRunning: boolean
}

function CommitPanel({ stagedCount, isBusy, isCommitRunning }: CommitPanelProps): JSX.Element {
  const [commitMsg, setCommitMsg] = useState('')
  const [isAiGenerating, setIsAiGenerating] = useState(false)
  const showSuccess = useUiStore((state) => state.showSuccess)
  const setError = useUiStore((state) => state.setError)

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) return
    await createCommit(commitMsg.trim())
    setCommitMsg('')
  }, [commitMsg])

  const handleGenerateCommitMessage = useCallback(async () => {
    // P1 智能提交入口：调用 Agent 基于暂存区 diff 生成提交信息。
    setIsAiGenerating(true)
    try {
      const result = await generateSmartCommitMessage()
      if (result.success && result.data) {
        setCommitMsg(result.data)
        showSuccess(result.fallback ? '已使用模板生成提交信息' : 'AI 提交信息已生成')
      } else {
        setError(result.error || 'AI 生成提交信息失败')
      }
    } finally {
      setIsAiGenerating(false)
    }
  }, [setError, showSuccess])

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
        <Tooltip title="AI 生成提交信息">
          <Button
            className={styles['ig-ai-btn']}
            icon={<ThunderboltOutlined />}
            disabled={isBusy || isCommitRunning}
            loading={isAiGenerating}
            onClick={handleGenerateCommitMessage}
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
