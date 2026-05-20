import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { ClusterOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { Button, Input, Radio, Space, Tag, Tooltip } from 'antd'

import { createCommit } from '../../services/gitWorkflowService'
import {
  analyzeSmartCommitChanges,
  generateSmartCommitMessage,
  stageGroupAndGenerateMessage,
  type CommitIntentGroup
} from '../../services/smartCommitService'
import { useCommitPanelModel } from '../../viewModels'
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
  const [isAnalyzingGroups, setIsAnalyzingGroups] = useState(false)
  const [groups, setGroups] = useState<CommitIntentGroup[]>([])
  const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null)
  const { showSuccess, setError } = useCommitPanelModel()

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

  const handleAnalyzeGroups = useCallback(async () => {
    // 文件级意图分组：先让 AI 给出分组，用户再选择某一组进入暂存和生成信息。
    setIsAnalyzingGroups(true)
    try {
      const result = await analyzeSmartCommitChanges()
      if (result.success && result.data && result.data.groups.length > 0) {
        setGroups(result.data.groups)
        setSelectedGroupIndex(0)
        showSuccess(result.fallback ? '已使用模板生成变更分组' : 'AI 变更分组已生成')
      } else {
        setError(result.error || 'AI 变更分组失败')
      }
    } finally {
      setIsAnalyzingGroups(false)
    }
  }, [setError, showSuccess])

  const handleStageSelectedGroup = useCallback(async () => {
    if (selectedGroupIndex === null) return
    const group = groups[selectedGroupIndex]
    if (!group) return

    setIsAiGenerating(true)
    try {
      const result = await stageGroupAndGenerateMessage(group)
      if (result.success && result.data) {
        setCommitMsg(result.data.message)
        showSuccess(result.data.fallback ? '已暂存分组并使用模板生成提交信息' : '已暂存分组并生成提交信息')
      } else {
        setError(result.error || '按分组生成提交信息失败')
      }
    } finally {
      setIsAiGenerating(false)
    }
  }, [groups, selectedGroupIndex, setError, showSuccess])

  return (
    <div className={styles['ig-commit-panel']}>
      <div className={styles['ig-group-toolbar']}>
        <Button
          size="small"
          icon={<ClusterOutlined />}
          loading={isAnalyzingGroups}
          disabled={isBusy || isCommitRunning}
          onClick={handleAnalyzeGroups}
        >
          分析变更分组
        </Button>
        {groups.length > 0 && (
          <Button
            size="small"
            type="primary"
            loading={isAiGenerating}
            disabled={selectedGroupIndex === null || isBusy || isCommitRunning}
            onClick={handleStageSelectedGroup}
          >
            暂存所选分组
          </Button>
        )}
      </div>

      {groups.length > 0 && (
        <Radio.Group
          className={styles['ig-group-list']}
          value={selectedGroupIndex}
          onChange={(event) => setSelectedGroupIndex(event.target.value)}
        >
          <Space direction="vertical" size={6}>
            {groups.map((group, index) => (
              <Radio key={`${group.type}-${group.summary}-${index}`} value={index}>
                <div className={styles['ig-group-item']}>
                  <div className={styles['ig-group-title']}>
                    <Tag color="blue">{group.type}</Tag>
                    <span>{group.summary}</span>
                  </div>
                  <div className={styles['ig-group-files']}>{group.files.join('、')}</div>
                </div>
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      )}

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
