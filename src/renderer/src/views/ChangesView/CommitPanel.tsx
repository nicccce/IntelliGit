import type { JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { CheckCircleOutlined, CheckOutlined, CloseOutlined, ClusterOutlined, RocketOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { Alert, Button, Collapse, Input, Radio, Space, Tag, Tooltip } from 'antd'

import { createCommit } from '../../services/gitWorkflowService'
import {
  analyzeSmartCommitChanges,
  generateSmartCommitMessage,
  stageGroupAndGenerateMessage,
  type CommitIntentGroup,
  type SmartCommitAnalysisResult
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
  const [analysisSummary, setAnalysisSummary] = useState<SmartCommitAnalysisResult | null>(null)
  const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null)
  const [smartCommitNotice, setSmartCommitNotice] = useState<string | null>(null)
  const [commitFeedback, setCommitFeedback] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const { showSuccess, setError } = useCommitPanelModel()
  const normalizedCommitMsg = useMemo(() => commitMsg.trim(), [commitMsg])
  const canCommit = normalizedCommitMsg.length > 0 && stagedCount > 0 && !isBusy && !isCommitRunning
  const analysisConfidence = analysisSummary?.confidence || 'low'
  const analysisHeadline = analysisSummary?.analysisSummary || '已完成智能分组分析'
  const analysisKinds = analysisSummary?.changeKinds?.slice(0, 4) || []
  const semanticRisks = analysisSummary?.semanticRisks || []
  const highestRiskLevel = semanticRisks.some((risk) => risk.level === 'high')
    ? 'high'
    : semanticRisks.some((risk) => risk.level === 'medium')
      ? 'medium'
      : semanticRisks.length > 0
        ? 'low'
        : null

  const hasAnalysis = !!(analysisSummary || smartCommitNotice || groups.length > 0)

  const stageGroup = useCallback(async (group: CommitIntentGroup) => {
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
  }, [setError, showSuccess])

  const handleSelectGroup = useCallback(
    (index: number, currentGroups: CommitIntentGroup[]) => {
      setSelectedGroupIndex(index)
      const group = currentGroups[index]
      if (group) stageGroup(group)
    },
    [stageGroup]
  )

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
      setSmartCommitNotice(null)
      if (selectedGroupIndex !== null && groups.length > 0) {
        const nextGroups = groups.filter((_, i) => i !== selectedGroupIndex)
        setGroups(nextGroups)
        if (nextGroups.length > 0) {
          handleSelectGroup(Math.min(selectedGroupIndex, nextGroups.length - 1), nextGroups)
        } else {
          setSelectedGroupIndex(null)
        }
      }
      setCommitFeedback({ type: 'success', message: successMessage })
      showSuccess(successMessage)
      return
    }

    setCommitFeedback({ type: 'error', message: result.error ? `提交失败: ${result.error}` : '提交失败' })
  }, [normalizedCommitMsg, setError, showSuccess, stagedCount, selectedGroupIndex, groups, handleSelectGroup])

  const handleGenerateCommitMessage = useCallback(async () => {
    // P1 智能提交入口：调用 Agent 基于暂存区 diff 生成提交信息。
    setIsAiGenerating(true)
    try {
      const result = await generateSmartCommitMessage()
      if (result.success && result.data) {
        setCommitMsg(result.data)
        setSmartCommitNotice(null)
        if (result.fallback) {
          setCommitFeedback({ type: 'success', message: result.error || 'AI 未启用，已使用本地模板生成提交信息' })
        }
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
        setAnalysisSummary(result.data)
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

  const handleAnalyzeAndStage = useCallback(async () => {
    setIsAnalyzingGroups(true)
    setIsAiGenerating(true)
    try {
      const result = await analyzeSmartCommitChanges()
      if (!result.success || !result.data || result.data.groups.length === 0) {
        setSmartCommitNotice(null)
        setError(result.error || '变更分组失败')
        return
      }

      setGroups(result.data.groups)
      setAnalysisSummary(result.data)
      const nextGroup = result.data.groups[0]
      setSelectedGroupIndex(0)
      setSmartCommitNotice(result.fallback ? result.error || 'AI 未启用，已使用本地模板生成变更分组' : null)

      const stagedResult = await stageGroupAndGenerateMessage(nextGroup)
      if (stagedResult.success && stagedResult.data) {
        setCommitMsg(stagedResult.data.message)
        setSmartCommitNotice(
          stagedResult.data.fallback ? stagedResult.data.fallbackReason || 'AI 未启用，已使用本地模板生成提交信息' : null
        )
        showSuccess(stagedResult.data.fallback ? '已使用本地模板完成分组提交信息生成' : '已完成分组分析并生成提交信息')
      } else {
        setError(stagedResult.error || '按分组生成提交信息失败')
      }
    } finally {
      setIsAnalyzingGroups(false)
      setIsAiGenerating(false)
    }
  }, [setError, showSuccess])

  const handleStageSelectedGroup = useCallback(async () => {
    if (selectedGroupIndex === null) return
    const group = groups[selectedGroupIndex]
    if (group) stageGroup(group)
  }, [groups, selectedGroupIndex, stageGroup])

  const handleCloseAnalysis = useCallback(() => {
    setGroups([])
    setAnalysisSummary(null)
    setSmartCommitNotice(null)
    setSelectedGroupIndex(null)
  }, [])

  return (
    <div
      className={`${styles['ig-commit-panel']} ${hasAnalysis ? styles['ig-commit-panel--expanded'] : ''}`}
      data-commit-panel-expanded={hasAnalysis ? '' : undefined}
    >
      <div className={styles['ig-smart-toolbar']}>
        <Tooltip title="分析变更分组">
          <Button
            size="small"
            icon={<ClusterOutlined />}
            loading={isAnalyzingGroups}
            disabled={isBusy || isCommitRunning}
            onClick={handleAnalyzeGroups}
          />
        </Tooltip>
        <Tooltip title="智能暂存并生成提交信息">
          <Button
            size="small"
            type="primary"
            icon={<RocketOutlined />}
            loading={isAnalyzingGroups || isAiGenerating}
            disabled={isBusy || isCommitRunning}
            onClick={handleAnalyzeAndStage}
          />
        </Tooltip>
        {groups.length > 0 && (
          <Tooltip title="暂存所选分组">
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              loading={isAiGenerating}
              disabled={selectedGroupIndex === null || isBusy || isCommitRunning}
              onClick={handleStageSelectedGroup}
            />
          </Tooltip>
        )}
      </div>

      {(analysisSummary || smartCommitNotice || groups.length > 0) && (
        <div className={styles['ig-analysis-card']}>
          <div className={styles['ig-analysis-header']}>
            <div className={styles['ig-analysis-title-block']}>
              <div className={styles['ig-analysis-title']}>智能分析</div>
              <div className={styles['ig-analysis-subtitle']}>
                {analysisSummary ? analysisHeadline : smartCommitNotice || '等待分析结果'}
              </div>
            </div>
            <div className={styles['ig-analysis-header-right']}>
              {analysisSummary && (
                <Tag
                  color={
                    analysisConfidence === 'high'
                      ? 'green'
                      : analysisConfidence === 'medium'
                        ? 'blue'
                        : 'gold'
                  }
                >
                  {analysisConfidence}
                </Tag>
              )}
              <Button
                size="small"
                type="text"
                icon={<CloseOutlined />}
                onClick={handleCloseAnalysis}
                className={styles['ig-analysis-close']}
              />
            </div>
          </div>
          {highestRiskLevel && (
            <div className={styles['ig-smart-notice']}>
              {highestRiskLevel === 'high'
                ? '检测到高风险语义冲突，请重点审查分组与提交内容'
                : highestRiskLevel === 'medium'
                  ? '检测到中风险语义冲突，建议在提交前确认接口与逻辑同步'
                  : '检测到少量语义风险，建议人工复核'}
            </div>
          )}

          {analysisKinds.length > 0 && (
            <div className={styles['ig-analysis-tags']}>
              {analysisKinds.map((kind) => (
                <Tag key={kind} color="geekblue">
                  {kind}
                </Tag>
              ))}
            </div>
          )}

          {smartCommitNotice && <div className={styles['ig-smart-notice']}>{smartCommitNotice}</div>}

          {semanticRisks.length > 0 && (
            <Collapse
              className={styles['ig-group-collapse']}
              size="small"
              defaultActiveKey={[]}
              items={[
                {
                  key: 'risks',
                  label: `语义风险 ${semanticRisks.length} 项`,
                  children: (
                    <Space direction="vertical" size={8} className={styles['ig-risk-list']}>
                      {semanticRisks.map((risk, index) => (
                        <div key={`${risk.type}-${risk.files.join(',')}-${index}`} className={styles['ig-risk-item']}>
                          <div className={styles['ig-risk-head']}>
                            <Tag
                              color={
                                risk.level === 'high' ? 'red' : risk.level === 'medium' ? 'gold' : 'blue'
                              }
                            >
                              {risk.level}
                            </Tag>
                            <Tag color="geekblue">{risk.type}</Tag>
                            <span className={styles['ig-risk-desc']}>{risk.description}</span>
                          </div>
                          <div className={styles['ig-risk-meta']}>
                            <span>文件：{risk.files.join('、')}</span>
                            <span>符号：{risk.symbols.length > 0 ? risk.symbols.join('、') : '无'}</span>
                          </div>
                          {risk.evidence.length > 0 && (
                            <div className={styles['ig-risk-evidence']}>
                              {risk.evidence.join(' ｜ ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </Space>
                  )
                }
              ]}
            />
          )}

          {semanticRisks.length > 0 && (
            <Collapse
              className={styles['ig-group-collapse']}
              size="small"
              defaultActiveKey={[]}
              items={[
                {
                  key: 'risks',
                  label: `语义风险 ${semanticRisks.length} 项`,
                  children: (
                    <div className={styles['ig-risk-list']}>
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        {semanticRisks.map((risk, index) => (
                          <div key={`${risk.type}-${risk.files.join('-')}-${index}`} className={styles['ig-risk-item']}>
                            <div className={styles['ig-risk-head']}>
                              <Tag
                                color={
                                  risk.level === 'high' ? 'red' : risk.level === 'medium' ? 'gold' : 'blue'
                                }
                              >
                                {risk.level}
                              </Tag>
                              <Tag color="geekblue">{risk.type}</Tag>
                              {risk.files.slice(0, 3).map((file) => (
                                <Tag key={file}>{file}</Tag>
                              ))}
                            </div>
                            <div className={styles['ig-risk-desc']}>{risk.description}</div>
                            <div className={styles['ig-risk-meta']}>
                              {risk.symbols.length > 0 && <span>符号：{risk.symbols.join('、')}</span>}
                              {risk.files.length > 0 && <span>文件：{risk.files.join('、')}</span>}
                            </div>
                            {risk.evidence.length > 0 && (
                              <div className={styles['ig-risk-evidence']}>
                                证据：{risk.evidence.join(' ｜ ')}
                              </div>
                            )}
                          </div>
                        ))}
                      </Space>
                    </div>
                  )
                }
              ]}
            />
          )}

          {groups.length > 0 && (
            <Collapse
              className={styles['ig-group-collapse']}
              size="small"
              defaultActiveKey={[]}
              items={[
                {
                  key: 'groups',
                  label: `查看 ${groups.length} 个分组`,
                  children: (
                    <Radio.Group
                      className={styles['ig-group-list']}
                      value={selectedGroupIndex}
                      onChange={(event) => handleSelectGroup(event.target.value, groups)}
                    >
                      <Space direction="vertical" size={6} className={styles['ig-group-space']}>
                        {groups.map((group, index) => {
                          const groupConfidence = group.confidence || analysisConfidence
                          return (
                            <Radio
                              key={`${group.type}-${group.summary}-${index}`}
                              className={styles['ig-group-radio']}
                              value={index}
                            >
                              <div className={styles['ig-group-item']}>
                                <div className={styles['ig-group-title']}>
                                  <Tag color="blue">{group.type}</Tag>
                                  <Tag
                                    color={
                                      groupConfidence === 'high'
                                        ? 'green'
                                        : groupConfidence === 'medium'
                                          ? 'blue'
                                          : 'gold'
                                    }
                                  >
                                    {groupConfidence}
                                  </Tag>
                                  <span>{group.summary}</span>
                                </div>
                                <div className={styles['ig-group-files']}>
                                  {group.files.join('、')}
                                </div>
                              </div>
                            </Radio>
                          )
                        })}
                      </Space>
                    </Radio.Group>
                  )
                }
              ]}
            />
          )}
        </div>
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
          rows={4}
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
