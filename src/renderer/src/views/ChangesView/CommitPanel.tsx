import type { JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { CheckCircleOutlined, ClusterOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { Alert, Button, Input, Radio, Space, Tag, Tooltip } from 'antd'

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
  const [smartCommitNotice, setSmartCommitNotice] = useState<string | null>(null)
  const [commitFeedback, setCommitFeedback] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const { showSuccess, setError } = useCommitPanelModel()
  const normalizedCommitMsg = useMemo(() => commitMsg.trim(), [commitMsg])
  const canCommit = normalizedCommitMsg.length > 0 && stagedCount > 0 && !isBusy && !isCommitRunning

  const handleCommit = useCallback(async () => {
    if (!normalizedCommitMsg) {
      setError('请输入提交信息')
      return
    }
    if (stagedCount === 0) {
      setError('请先暂存至少一个文件')
      return
    }

    setCommitFeedback(null)
    const result = await createCommit(normalizedCommitMsg)
    if (result.success) {
      const successMessage = `提交成功${result.hash ? `: ${result.hash.slice(0, 8)}` : ''}`
      setCommitMsg('')
      setGroups([])
      setSelectedGroupIndex(null)
      setSmartCommitNotice(null)
      setCommitFeedback({ type: 'success', message: successMessage })
      showSuccess(successMessage)
      return
    }

    setCommitFeedback({ type: 'error', message: result.error ? `提交失败: ${result.error}` : '提交失败' })
  }, [normalizedCommitMsg, setError, showSuccess, stagedCount])

  const handleGenerateCommitMessage = useCallback(async () => {
    // P1 智能提交入口：调用 Agent 基于暂存区 diff 生成提交信息。
    setIsAiGenerating(true)
    try {
      const result = await generateSmartCommitMessage()
      if (result.success && result.data) {
        setCommitMsg(result.data)
        setSmartCommitNotice(result.fallback ? result.error || 'AI 未启用，已使用本地模板生成提交信息' : null)
        showSuccess(result.fallback ? '已使用本地模板生成提交信息' : 'AI 提交信息已生成')
      } else {
        setSmartCommitNotice(null)
        setError(result.error || '生成提交信息失败')
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
        setSmartCommitNotice(result.fallback ? result.error || 'AI 未启用，已使用本地模板生成变更分组' : null)
        showSuccess(result.fallback ? '已使用本地模板生成变更分组' : 'AI 变更分组已生成')
      } else {
        setSmartCommitNotice(null)
        setError(result.error || '变更分组失败')
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
        setSmartCommitNotice(
          result.data.fallback ? result.data.fallbackReason || 'AI 未启用，已使用本地模板生成提交信息' : null
        )
        showSuccess(result.data.fallback ? '已暂存分组并使用本地模板生成提交信息' : '已暂存分组并生成提交信息')
      } else {
        setSmartCommitNotice(null)
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

      {smartCommitNotice && <div className={styles['ig-smart-notice']}>{smartCommitNotice}</div>}

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
          onChange={(event) => {
            setCommitMsg(event.target.value)
            setCommitFeedback(null)
          }}
          rows={3}
          showCount
          maxLength={500}
          disabled={isCommitRunning}
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

      <div className={styles['ig-commit-confirm']}>
        <div className={styles['ig-commit-summary']}>
          {normalizedCommitMsg ? '提交信息已就绪，可继续编辑后确认提交' : '请生成或输入 Commit Message'}
        </div>
        <Button
          id="btn-commit"
          className={styles['ig-commit-btn']}
          type="primary"
          icon={<CheckCircleOutlined />}
          onClick={handleCommit}
          disabled={!canCommit}
          loading={isCommitRunning}
        >
          {`确认创建 Commit (${stagedCount} 个文件已暂存)`}
        </Button>
      </div>

      {commitFeedback && (
        <Alert
          className={styles['ig-commit-feedback']}
          type={commitFeedback.type}
          message={commitFeedback.message}
          showIcon
        />
      )}
    </div>
  )
}

export default CommitPanel
