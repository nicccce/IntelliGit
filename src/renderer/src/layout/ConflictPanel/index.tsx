import type { JSX } from 'react'
import { useMemo, useState, useCallback } from 'react'
import { Alert, Button, Card, Input, List, Select, Tag } from 'antd'
import {
  CheckOutlined,
  RobotOutlined,
  BranchesOutlined,
  CopyOutlined,
  WarningOutlined
} from '@ant-design/icons'

import SidePanelShell from '../../components/SidePanelShell'
import { invokeGit } from '../../api/gitClient'
import { useDiffViewModel } from '../../viewModels'
import { useDiffStore, useLlmConfigStore, useUiStore } from '../../store'
import { classNames } from '../../utils/classNames'
import { renderAstContext } from '../../utils/astChangeAnalyzer'
import { buildConflictRiskReport, formatFileRiskTitle } from '../../services/conflictRiskService'
import { suggestConflictResolution } from '../../services/conflictResolutionService'
import type { ConflictRiskReport } from '../../services/conflictRiskService'
import type { ConflictResolutionSuggestion } from '../../services/conflictResolutionService'
import styles from './ConflictPanel.module.css'

const { TextArea } = Input

interface ConflictPanelProps {
  isOpen: boolean
  onClose: () => void
}

const SAMPLE_HINT = '请选择存在冲突的文件，或粘贴 ancestor / ours / theirs 内容进行对比。'

type ConflictBlock = {
  ancestor: string
  ours: string
  theirs: string
}

function parseConflictBlocks(text: string): ConflictBlock[] {
  const blocks: ConflictBlock[] = []
  const lines = text.split('\n')
  let i = 0

  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<< ')) {
      i++
      continue
    }

    i++
    const oursLines: string[] = []
    const ancestorLines: string[] = []
    const theirsLines: string[] = []
    let inAncestor = false
    let inTheirs = false

    while (i < lines.length && !lines[i].startsWith('>>>>>>> ')) {
      const line = lines[i]
      if (line.startsWith('||||||| ')) {
        inAncestor = true
      } else if (line.startsWith('=======') && !inTheirs) {
        inAncestor = false
        inTheirs = true
      } else if (inAncestor) {
        ancestorLines.push(line)
      } else if (inTheirs) {
        theirsLines.push(line)
      } else {
        oursLines.push(line)
      }
      i++
    }

    blocks.push({
      ancestor: ancestorLines.join('\n').trim(),
      ours: oursLines.join('\n').trim(),
      theirs: theirsLines.join('\n').trim()
    })

    while (i < lines.length && !lines[i].startsWith('<<<<<<< ')) i++
  }

  return blocks.filter((block) => block.ours || block.theirs || block.ancestor)
}

function ConflictPanel({ isOpen, onClose }: ConflictPanelProps): JSX.Element | null {
  const { selectedFilePath, diffSource, workdirDiff, stagedDiff } = useDiffViewModel()
  const llmConfig = useLlmConfigStore((state) => state.config)
  const [conflictedFiles, setConflictedFiles] = useState<string[]>([])
  const [ancestor, setAncestor] = useState('')
  const [ours, setOurs] = useState('')
  const [theirs, setTheirs] = useState('')
  const [selectedStrategy, setSelectedStrategy] = useState<'manual' | 'take_ours' | 'take_theirs' | 'merge_both'>('manual')
  const [applied, setApplied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestion, setSuggestion] = useState<ConflictResolutionSuggestion | null>(null)
  const [riskReport, setRiskReport] = useState<ConflictRiskReport | null>(null)
  const [blocks, setBlocks] = useState<ConflictBlock[]>([])
  const [activeBlockIndex, setActiveBlockIndex] = useState(0)

  const diff = diffSource === 'staged' ? stagedDiff : workdirDiff
  const diffText = diff?.diff ?? ''
  const hasConflictFile = useMemo(() => conflictedFiles.includes(selectedFilePath || ''), [conflictedFiles, selectedFilePath])
  const selectedFileSummary = useMemo(() => {
    if (!selectedFilePath) return SAMPLE_HINT
    return diff ? `当前文件：${selectedFilePath}` : `当前文件：${selectedFilePath}（差异加载中）`
  }, [selectedFilePath, diff])

  const currentBlock = blocks[activeBlockIndex]
  const astContext = useMemo(() => selectedFilePath && diffText ? renderAstContext([selectedFilePath], diffText) : undefined, [diffText, selectedFilePath])
  const handleSelectRiskFile = useCallback(async (filePath: string) => {
    await useDiffStore.getState().selectFile(filePath, 'unstaged')
  }, [])
  const suggestionText = useMemo(() => {
    const fileName = selectedFilePath?.split(/[\\/]/).pop() || 'unknown'
    if (suggestion) return suggestion.explanation
    if (!currentBlock) {
      return `AI 建议：先载入冲突三方内容，再判断 ${fileName} 的合并策略。`
    }
    if ((currentBlock.ours || currentBlock.theirs) && !currentBlock.ancestor) {
      return 'AI 建议：优先对比 ours 与 theirs；如果一侧明显是补充逻辑，可考虑 merge_both。'
    }
    return 'AI 建议：结合 ancestor 判断变更来源，避免把双方独立改动覆盖掉。'
  }, [currentBlock, selectedFilePath, suggestion])

  const handleSuggest = useCallback(async () => {
    if (!selectedFilePath) return
    setSuggesting(true)
    try {
      const source = currentBlock ?? { ancestor, ours, theirs }
      const nextSuggestion = await suggestConflictResolution(llmConfig, {
        filePath: selectedFilePath,
        ancestor: source.ancestor,
        ours: source.ours,
        theirs: source.theirs,
        context: astContext
      })
      setSuggestion(nextSuggestion)
      setSelectedStrategy(nextSuggestion.strategy)
      setApplied(false)
      useUiStore.getState().showSuccess(nextSuggestion.fallback ? '已生成规则化冲突建议' : '已生成 AI 冲突建议')
    } catch (error) {
      useUiStore.getState().setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSuggesting(false)
    }
  }, [ancestor, astContext, currentBlock, llmConfig, ours, selectedFilePath, theirs])

  const handleApply = useCallback(async () => {
    const source = currentBlock ?? { ancestor, ours, theirs }
    const strategy = suggestion?.strategy ?? selectedStrategy
    const target =
      suggestion?.resolvedContent ||
      (strategy === 'take_ours'
        ? source.ours
        : strategy === 'take_theirs'
          ? source.theirs
          : strategy === 'merge_both'
            ? `${source.ours}\n\n${source.theirs}`
            : source.ours || source.theirs)
    if (!target.trim()) return
    await navigator.clipboard?.writeText(target)
    setApplied(true)
    useUiStore.getState().showSuccess('已复制建议结果，可粘贴到冲突文件中')
  }, [ancestor, currentBlock, selectedStrategy, suggestion, ours, theirs])

  const handleLoadConflict = useCallback(async () => {
    if (!selectedFilePath) return
    setLoading(true)
    try {
      const status = await invokeGit('merge.status')
      const data = status.data as { conflictedFiles?: string[] } | undefined
      const files = data?.conflictedFiles ?? []
      setConflictedFiles(files)

      const raw = await invokeGit('diff.workdirRaw', { path: selectedFilePath })
      const text = raw.diff || ''
      const parsedBlocks = parseConflictBlocks(text)
      setBlocks(parsedBlocks)
      setRiskReport(buildConflictRiskReport(files.length ? files : [selectedFilePath], text))
      setActiveBlockIndex(0)
      const first = parsedBlocks[0]
      if (first) {
        setAncestor(first.ancestor)
        setOurs(first.ours)
        setTheirs(first.theirs)
      }
      setApplied(false)
      useUiStore.getState().showSuccess('已尝试自动读取冲突标记')
    } catch (error) {
      useUiStore.getState().setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [selectedFilePath])

  if (!isOpen) return null

  return (
    <SidePanelShell title="冲突 AI 建议" isOpen={isOpen} onClose={onClose} maxWidth={720}>
      <div className={styles['ig-conflict-panel']}>
        <div className={styles['ig-conflict-meta']}>
          <Tag color="blue"><BranchesOutlined /> 三栏对比</Tag>
          <span>{selectedFileSummary}</span>
          {hasConflictFile && <Tag color="red">冲突文件</Tag>}
          {conflictedFiles.length > 0 && <Tag color="gold">{`检测到 ${conflictedFiles.length} 个冲突文件`}</Tag>}
        </div>

        <div className={styles['ig-conflict-strategy']}>
          <Select
            value={selectedStrategy}
            onChange={(value) => setSelectedStrategy(value)}
            options={[
              { value: 'manual', label: '手动合并' },
              { value: 'take_ours', label: '保留 ours' },
              { value: 'take_theirs', label: '保留 theirs' },
              { value: 'merge_both', label: '合并双方' }
            ]}
          />
          <Button loading={loading} onClick={handleLoadConflict}>
            自动读取冲突
          </Button>
          <Button icon={<RobotOutlined />} loading={suggesting} onClick={handleSuggest} disabled={!ours && !theirs}>
            生成 AI 建议
          </Button>
          <Button icon={<CheckOutlined />} type="primary" onClick={handleApply} disabled={!ours && !theirs}>
            一键采纳建议
          </Button>
        </div>

        {riskReport && (
          <Card size="small" title="语义风险地图" className={styles['ig-conflict-risk-card']}>
            <div className={styles['ig-conflict-risk-summary']}>{riskReport.summary}</div>
            <List
              size="small"
              dataSource={riskReport.files}
              locale={{ emptyText: '暂无文件级语义风险' }}
              renderItem={(file) => (
                <List.Item
                  className={styles['ig-conflict-risk-item']}
                  actions={[
                    <Button key="jump" size="small" onClick={() => void handleSelectRiskFile(file.filePath)}>
                      跳转
                    </Button>
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <div className={styles['ig-conflict-risk-title']}>
                        <Tag color={file.level === 'high' ? 'red' : file.level === 'medium' ? 'gold' : 'green'}>{file.level}</Tag>
                        <span>{file.filePath}</span>
                      </div>
                    }
                    description={
                      <div className={styles['ig-conflict-risk-desc']}>
                        <div>{formatFileRiskTitle(file)}</div>
                        {file.reasons.slice(0, 2).map((reason) => <div key={reason}>{reason}</div>)}
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        )}

        {blocks.length > 1 && (
          <div className={styles['ig-conflict-blocks']}>
            <Tag color="geekblue">已识别 {blocks.length} 个冲突块</Tag>
            <Select
              value={activeBlockIndex}
              onChange={(value) => {
                setActiveBlockIndex(value)
                const next = blocks[value]
                if (next) {
                  setAncestor(next.ancestor)
                  setOurs(next.ours)
                  setTheirs(next.theirs)
                  setSuggestion(null)
                  setApplied(false)
                }
              }}
              options={blocks.map((_, index) => ({ value: index, label: `冲突块 ${index + 1}` }))}
            />
          </div>
        )}

        <div className={styles['ig-conflict-grid']}>
          <CompareColumn title="ancestor" value={ancestor} onChange={setAncestor} placeholder="粘贴共同祖先内容" />
          <CompareColumn title="ours" value={ours} onChange={setOurs} placeholder="粘贴当前分支内容" />
          <CompareColumn title="theirs" value={theirs} onChange={setTheirs} placeholder="粘贴目标分支内容" />
        </div>

        <div className={styles['ig-conflict-suggestion']}>
          <div className={styles['ig-conflict-suggestion-title']}>
            <CheckOutlined /> AI 建议
            {suggestion?.fallback && <Tag color="gold">规则降级</Tag>}
            {suggestion && <Tag color="blue">{suggestion.strategy}</Tag>}
          </div>
          {astContext && (
            <Alert
              type="info"
              showIcon
              icon={<WarningOutlined />}
              message="已注入 AST 上下文"
              description={astContext}
              className={styles['ig-conflict-ast-context']}
            />
          )}
          <div className={styles['ig-conflict-suggestion-body']}>{suggestionText}</div>
          {suggestion?.warnings?.map((warning) => (
            <div key={warning} className={styles['ig-conflict-warning']}>{warning}</div>
          ))}
          {suggestion?.resolvedContent && (
            <TextArea value={suggestion.resolvedContent} readOnly rows={8} className={styles['ig-conflict-resolved']} />
          )}
          {applied && <div className={styles['ig-conflict-applied']}>已采纳建议内容并复制到剪贴板</div>}
          <Button icon={<CopyOutlined />} onClick={handleApply}>
            复制建议内容
          </Button>
        </div>
      </div>
    </SidePanelShell>
  )
}

function CompareColumn({
  title,
  value,
  onChange,
  placeholder
}: {
  title: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}): JSX.Element {
  return (
    <div className={styles['ig-conflict-column']}>
      <div className={classNames(styles['ig-conflict-column-title'])}>{title}</div>
      <TextArea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={14} />
    </div>
  )
}

export default ConflictPanel
