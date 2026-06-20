import type { JSX } from 'react'
import { useMemo, useState, useCallback, useEffect } from 'react'
import { Alert, Button, Card, Input, List, Select, Tag } from 'antd'
import {
  CheckOutlined,
  RobotOutlined,
  BranchesOutlined,
  WarningOutlined,
  FileExclamationOutlined
} from '@ant-design/icons'

import SidePanelShell from '../../components/SidePanelShell'
import { invokeGit } from '../../api/gitClient'
import { useDiffViewModel } from '../../viewModels'
import { useDiffStore, useGitStatusStore, useLlmConfigStore, useRepositoryStore, useUiStore } from '../../store'
import { selectCurrentRepoPath } from '../../store/selectors/repositorySelectors'
import { selectBranches, selectCurrentBranch } from '../../store/selectors/gitStatusSelectors'
import { classNames } from '../../utils/classNames'
import { buildConflictAnalysisContext, renderAstContext } from '../../utils/astChangeAnalyzer'
import { buildConflictRiskReport, formatFileRiskTitle } from '../../services/conflictRiskService'
import {
  buildRuleBasedConflictSuggestion,
  suggestConflictResolution
} from '../../services/conflictResolutionService'
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

type ConflictBlockSummary = {
  index: number
  label: string
  description: string
  riskLevel: 'low' | 'medium' | 'high'
  recommendedStrategy: 'take_ours' | 'take_theirs' | 'merge_both' | 'manual'
}

function countNonEmptyLines(value: string): number {
  return value.split('\n').filter((line) => line.trim()).length
}

function summarizeConflictBlock(block: ConflictBlock, index: number): ConflictBlockSummary {
  const oursLines = countNonEmptyLines(block.ours)
  const theirsLines = countNonEmptyLines(block.theirs)
  const ancestorLines = countNonEmptyLines(block.ancestor)
  const suggestion = buildRuleBasedConflictSuggestion({
    filePath: `conflict-block-${index + 1}`,
    ancestor: block.ancestor,
    ours: block.ours,
    theirs: block.theirs
  })
  const maxSideLines = Math.max(oursLines, theirsLines)
  const riskLevel =
    suggestion.strategy === 'manual' || maxSideLines >= 24
      ? 'high'
      : !ancestorLines || Math.abs(oursLines - theirsLines) >= 8
        ? 'medium'
        : 'low'

  return {
    index,
    label: `冲突块 ${index + 1}`,
    description: `ours ${oursLines} 行 / theirs ${theirsLines} 行${ancestorLines ? ` / ancestor ${ancestorLines} 行` : ' / 无 ancestor'}`,
    riskLevel,
    recommendedStrategy: suggestion.strategy
  }
}


function ConflictPanel({ isOpen, onClose }: ConflictPanelProps): JSX.Element | null {
  const { selectedFilePath, diffSource, workdirDiff, stagedDiff } = useDiffViewModel()
  const llmConfig = useLlmConfigStore((state) => state.config)
  const repoPath = useRepositoryStore(selectCurrentRepoPath)
  const currentBranch = useGitStatusStore(selectCurrentBranch)
  const allBranches = useGitStatusStore(selectBranches)
  const [conflictedFiles, setConflictedFiles] = useState<string[]>([])
  const [merging, setMerging] = useState(false)
  const [mergeBranch, setMergeBranch] = useState<string | undefined>()
  // 面板内部选中的冲突文件（独立于左侧 DiffPanel 的选择）
  const [activeConflictFile, setActiveConflictFile] = useState<string | null>(null)
  const [isBinaryConflict, setIsBinaryConflict] = useState(false)
  const [ancestor, setAncestor] = useState('')
  const [ours, setOurs] = useState('')
  const [theirs, setTheirs] = useState('')
  const [resolved, setResolved] = useState(false)
  const [loading, setLoading] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestion, setSuggestion] = useState<ConflictResolutionSuggestion | null>(null)
  const [riskReport, setRiskReport] = useState<ConflictRiskReport | null>(null)
  const [blocks, setBlocks] = useState<ConflictBlock[]>([])
  const [activeBlockIndex, setActiveBlockIndex] = useState(0)

  // 打开面板时自动检查 merge 状态
  useEffect(() => {
    if (!isOpen) return
    void (async () => {
      try {
        const status = await invokeGit('merge.status')
        setMerging(!!status.merging)
        const files: string[] = status.conflictedFiles ?? []
        setConflictedFiles(files)
      } catch {
        // 非合并状态，静默忽略
      }
    })()
  }, [isOpen])

  const effectiveFilePath = activeConflictFile ?? selectedFilePath

  const diff = diffSource === 'staged' ? stagedDiff : workdirDiff
  const diffText = (diff as { diff?: string } | null)?.diff ?? ''
  const hasConflictFile = useMemo(() => conflictedFiles.includes(effectiveFilePath || ''), [conflictedFiles, effectiveFilePath])
  const selectedFileSummary = useMemo(() => {
    if (!effectiveFilePath) return SAMPLE_HINT
    return `当前文件：${effectiveFilePath}`
  }, [effectiveFilePath])

  const currentBlock = blocks[activeBlockIndex]
  const blockSummaries = useMemo(() => blocks.map((block, index) => summarizeConflictBlock(block, index)), [blocks])
  const activeBlockSummary = blockSummaries[activeBlockIndex]
  const [astContext, setAstContext] = useState<string | undefined>()
  const [conflictPromptContext, setConflictPromptContext] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    async function loadAstContext() {
      if (!effectiveFilePath || !diffText) {
        setAstContext(undefined)
        setConflictPromptContext(undefined)
        return
      }
      const [nextAstContext, nextConflictPromptContext] = await Promise.all([
        renderAstContext([effectiveFilePath], diffText),
        buildConflictAnalysisContext([effectiveFilePath], diffText)
      ])
      if (cancelled) return
      setAstContext(nextAstContext)
      setConflictPromptContext(nextConflictPromptContext)
    }
    void loadAstContext()
    return () => {
      cancelled = true
    }
  }, [diffText, effectiveFilePath])

  const handleSelectRiskFile = useCallback(async (filePath: string) => {
    await useDiffStore.getState().selectFile(filePath, 'unstaged')
  }, [])

  const suggestionText = useMemo(() => {
    const fileName = effectiveFilePath?.split(/[\\/]/).pop() || 'unknown'
    if (suggestion) return suggestion.explanation
    if (!currentBlock) {
      return `AI 建议：先载入冲突三方内容，再判断 ${fileName} 的合并策略。`
    }
    if ((currentBlock.ours || currentBlock.theirs) && !currentBlock.ancestor) {
      return 'AI 建议：优先对比 ours 与 theirs；如果一侧明显是补充逻辑，可考虑 merge_both。'
    }
    return 'AI 建议：结合 ancestor 判断变更来源，避免把双方独立改动覆盖掉。'
  }, [currentBlock, effectiveFilePath, suggestion])

  const handleSuggest = useCallback(async () => {
    if (!effectiveFilePath) return
    setSuggesting(true)
    try {
      const source = currentBlock ?? { ancestor, ours, theirs }
      const nextSuggestion = await suggestConflictResolution(llmConfig, {
        filePath: effectiveFilePath,
        ancestor: source.ancestor,
        ours: source.ours,
        theirs: source.theirs,
        context: conflictPromptContext || astContext
      })
      setSuggestion(nextSuggestion)
      setResolved(false)
      useUiStore.getState().showSuccess(nextSuggestion.fallback ? '已生成规则化冲突建议' : '已生成 AI 冲突建议')
    } catch (error) {
      useUiStore.getState().setError(error instanceof Error ? error.message : String(error))
    } finally {
      setSuggesting(false)
    }
  }, [ancestor, astContext, currentBlock, llmConfig, ours, effectiveFilePath, theirs])

  // 从冲突面板直接发起 git merge，若产生冲突则自动进入解决流程
  const handleStartMerge = useCallback(async () => {
    if (!mergeBranch || !repoPath) return
    setLoading(true)
    try {
      await window.electronAPI.executeGitCommand({
        repoPath,
        args: ['merge', '--no-edit', mergeBranch]
      })
      // 合并成功（快进或无冲突）
      useUiStore.getState().showSuccess(`已成功合并 ${mergeBranch}`)
      setMerging(false)
      setConflictedFiles([])
    } catch {
      // 合并失败（有冲突），读取冲突状态
      const status = await invokeGit('merge.status')
      setMerging(!!status.merging)
      const files: string[] = status.conflictedFiles ?? []
      setConflictedFiles(files)
      if (files.length > 0) {
        useUiStore.getState().showSuccess(`合并产生 ${files.length} 个冲突，请逐一解决`)
      }
    } finally {
      setLoading(false)
    }
  }, [mergeBranch, repoPath])

  // 所有冲突解决后，执行 merge.continue 创建合并提交
  const handleFinishMerge = useCallback(async () => {
    setLoading(true)
    try {
      await invokeGit('merge.continue', {})
      setMerging(false)
      setConflictedFiles([])
      setActiveConflictFile(null)
      setBlocks([])
      useUiStore.getState().showSuccess('合并提交已创建，分支合并完成！')
    } catch (error) {
      useUiStore.getState().setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  // 将 content 写入文件并 git add，真正解决冲突
  const handleResolveConflict = useCallback(async (content: string, label: string) => {
    if (!activeConflictFile || !content.trim()) return
    setLoading(true)
    try {
      await invokeGit('conflict.resolve', { path: activeConflictFile, content })
      setResolved(true)
      // 刷新冲突列表
      const status = await invokeGit('merge.status')
      const files: string[] = status.conflictedFiles ?? []
      setConflictedFiles(files)
      setMerging(!!status.merging)
      useUiStore.getState().showSuccess(`已应用「${label}」并标记 ${activeConflictFile} 为已解决`)
      if (files.length === 0) {
        useUiStore.getState().showSuccess('所有冲突已解决！可在智能助手输入"完成合并提交"')
      }
      setActiveConflictFile(null)
      setBlocks([])
    } catch (error) {
      useUiStore.getState().setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [activeConflictFile])

  // 加载指定文件的冲突内容：读取 index stage :1/:2/:3:，比 diff 更准确
  const handleLoadConflictFile = useCallback(async (filePath: string) => {
    setLoading(true)
    setActiveConflictFile(filePath)
    setSuggestion(null)
    setResolved(false)
    setIsBinaryConflict(false)
    setBlocks([])
    setRiskReport(null)
    try {
      const stage = await invokeGit('merge.stageContent', { path: filePath })

      if (stage.binary) {
        setIsBinaryConflict(true)
        setAncestor('')
        setOurs('')
        setTheirs('')
        useUiStore.getState().showSuccess('二进制冲突文件，请选择保留哪一侧')
        return
      }

      setAncestor(stage.ancestor)
      setOurs(stage.ours)
      setTheirs(stage.theirs)
      setActiveBlockIndex(0)

      // 用 ours 内容构造"单块"，供 AI 建议使用
      const syntheticBlock: ConflictBlock = {
        ancestor: stage.ancestor,
        ours: stage.ours,
        theirs: stage.theirs
      }
      setBlocks([syntheticBlock])
      setRiskReport(await buildConflictRiskReport([filePath], stage.ours + stage.theirs))
      useUiStore.getState().showSuccess('已载入冲突文件三方内容')
    } catch (error) {
      useUiStore.getState().setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  // 二进制/add-add 冲突：直接选择保留哪一侧
  const handleResolveBinary = useCallback(async (side: 'ours' | 'theirs') => {
    if (!activeConflictFile || !repoPath) return
    setLoading(true)
    try {
      // git checkout --ours/--theirs <file>
      await window.electronAPI.executeGitCommand({
        repoPath,
        args: ['checkout', `--${side}`, activeConflictFile]
      })
      // git add <file> 标记为已解决
      await window.electronAPI.executeGitCommand({
        repoPath,
        args: ['add', activeConflictFile]
      })
      // 刷新冲突列表
      const status = await invokeGit('merge.status')
      const files: string[] = status.conflictedFiles ?? []
      setConflictedFiles(files)
      setMerging(!!status.merging)

      const label = side === 'ours' ? '当前分支 (ours)' : '目标分支 (theirs)'
      useUiStore.getState().showSuccess(`已保留 ${label} 版本，冲突标记为已解决`)

      if (files.length === 0) {
        useUiStore.getState().showSuccess('所有冲突已解决！可以在智能助手里输入"完成合并提交"')
      }
      setIsBinaryConflict(false)
      setActiveConflictFile(null)
    } catch (error) {
      useUiStore.getState().setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [activeConflictFile, repoPath])

  // "自动读取冲突"：先刷新文件列表，再自动选中第一个文件
  const handleLoadConflict = useCallback(async () => {
    setLoading(true)
    try {
      const status = await invokeGit('merge.status')
      setMerging(!!status.merging)
      const files: string[] = status.conflictedFiles ?? []
      setConflictedFiles(files)

      const target = files[0] ?? effectiveFilePath
      if (!target) {
        useUiStore.getState().showSuccess(files.length ? '检测到冲突文件，请点击选择' : '当前没有检测到 merge 冲突')
        setLoading(false)
        return
      }
      // 加载第一个冲突文件
      await handleLoadConflictFile(target)
    } catch (error) {
      useUiStore.getState().setError(error instanceof Error ? error.message : String(error))
      setLoading(false)
    }
  }, [effectiveFilePath, handleLoadConflictFile])

  if (!isOpen) return null

  return (
    <SidePanelShell title="冲突 AI 建议" isOpen={isOpen} onClose={onClose} maxWidth={720}>
      <div className={styles['ig-conflict-panel']}>
        <div className={styles['ig-conflict-meta']}>
          <Tag color="blue"><BranchesOutlined /> 三栏对比</Tag>
          <span>{selectedFileSummary}</span>
          {hasConflictFile && <Tag color="red">冲突文件</Tag>}
          {merging && conflictedFiles.length > 0 && <Tag color="gold">{`${conflictedFiles.length} 个冲突文件`}</Tag>}
          {merging && conflictedFiles.length === 0 && <Tag color="green">已解决所有冲突</Tag>}
          {!merging && <Tag>未处于合并状态</Tag>}
        </div>

        {/* 未处于合并状态：提供分支选择器，直接从面板发起合并 */}
        {!merging && (
          <div className={styles['ig-conflict-start-bar']}>
            <span className={styles['ig-conflict-start-hint']}>
              选择要合并到 <strong>{currentBranch}</strong> 的分支：
            </span>
            <Select
              placeholder="选择分支"
              value={mergeBranch}
              onChange={setMergeBranch}
              className={styles['ig-conflict-branch-select']}
              options={allBranches
                .filter((b) => b.name !== currentBranch)
                .map((b) => ({ value: b.name, label: b.name }))}
            />
            <Button
              type="primary"
              loading={loading}
              disabled={!mergeBranch}
              onClick={() => void handleStartMerge()}
            >
              开始合并
            </Button>
          </div>
        )}

        {/* 所有冲突已解决，等待最终提交 */}
        {merging && conflictedFiles.length === 0 && (
          <div className={styles['ig-conflict-finish-bar']}>
            <span className={styles['ig-conflict-finish-hint']}>
              所有冲突已解决，点击右侧按钮完成合并并创建提交
            </span>
            <Button
              type="primary"
              icon={<CheckOutlined />}
              loading={loading}
              onClick={() => void handleFinishMerge()}
            >
              完成合并提交
            </Button>
          </div>
        )}

        {/* 冲突文件列表 — 打开面板自动展示，无需先在 DiffPanel 选文件 */}
        {merging && conflictedFiles.length > 0 && (
          <div className={styles['ig-conflict-file-list']}>
            {conflictedFiles.map((f) => (
              <div
                key={f}
                className={classNames(
                  styles['ig-conflict-file-item'],
                  activeConflictFile === f && styles['ig-conflict-file-item-active']
                )}
                onClick={() => void handleLoadConflictFile(f)}
              >
                <WarningOutlined className={styles['ig-conflict-file-icon']} />
                <span className={styles['ig-conflict-file-name']}>{f}</span>
              </div>
            ))}
          </div>
        )}

        <div className={styles['ig-conflict-strategy']}>
          <Button loading={loading} onClick={handleLoadConflict}>
            刷新冲突列表
          </Button>
          {!isBinaryConflict && (
            <Button icon={<RobotOutlined />} loading={suggesting} onClick={handleSuggest} disabled={!ours && !theirs}>
              生成 AI 建议
            </Button>
          )}
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

        {/* 二进制/add-add 冲突：无法三栏对比，直接选边 */}
        {isBinaryConflict && activeConflictFile && (
          <Card
            size="small"
            className={styles['ig-conflict-binary-card']}
            title={
              <span>
                <FileExclamationOutlined style={{ color: 'var(--accent-red)', marginRight: 6 }} />
                二进制 / 新增冲突文件
              </span>
            }
          >
            <div className={styles['ig-conflict-binary-desc']}>
              <p>
                <strong>{activeConflictFile}</strong> 是二进制文件或双方均为新增——
                Git 无法自动合并，只能保留其中一侧。
              </p>
              <p>选择后将自动执行 <code>git checkout --ours/--theirs</code> 并 <code>git add</code> 标记已解决。</p>
            </div>
            <div className={styles['ig-conflict-binary-actions']}>
              <Button
                type="primary"
                loading={loading}
                onClick={() => void handleResolveBinary('ours')}
              >
                保留 ours（当前分支）
              </Button>
              <Button
                danger
                loading={loading}
                onClick={() => void handleResolveBinary('theirs')}
              >
                保留 theirs（被合并分支）
              </Button>
            </div>
          </Card>
        )}

        {blocks.length > 0 && (
          <Card size="small" className={styles['ig-conflict-block-card']} title="冲突块导航">
            <div className={styles['ig-conflict-block-toolbar']}>
              <Tag color="geekblue">已识别 {blocks.length} 个冲突块</Tag>
              {activeBlockSummary && (
                <>
                  <Tag color={activeBlockSummary.riskLevel === 'high' ? 'red' : activeBlockSummary.riskLevel === 'medium' ? 'gold' : 'green'}>
                    {activeBlockSummary.riskLevel} risk
                  </Tag>
                  <Tag color="blue">建议：{activeBlockSummary.recommendedStrategy}</Tag>
                </>
              )}
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
                    setResolved(false)
                  }
                }}
                options={blockSummaries.map((summary) => ({
                  value: summary.index,
                  label: `${summary.label} · ${summary.riskLevel}`
                }))}
              />
            </div>
            <List
              size="small"
              dataSource={blockSummaries}
              renderItem={(summary) => (
                <List.Item
                  className={classNames(
                    styles['ig-conflict-block-item'],
                    summary.index === activeBlockIndex && styles['ig-conflict-block-item-active']
                  )}
                  onClick={() => {
                    setActiveBlockIndex(summary.index)
                    const next = blocks[summary.index]
                    if (next) {
                      setAncestor(next.ancestor)
                      setOurs(next.ours)
                      setTheirs(next.theirs)
                      setSuggestion(null)
                      setResolved(false)
                    }
                  }}
                >
                  <List.Item.Meta
                    title={
                      <div className={styles['ig-conflict-risk-title']}>
                        <Tag color={summary.riskLevel === 'high' ? 'red' : summary.riskLevel === 'medium' ? 'gold' : 'green'}>{summary.riskLevel}</Tag>
                        <span>{summary.label}</span>
                        <Tag color="blue">{summary.recommendedStrategy}</Tag>
                      </div>
                    }
                    description={summary.description}
                  />
                </List.Item>
              )}
            />
          </Card>
        )}

        {/* 仅文本冲突显示三栏对比和 AI 建议，二进制冲突不展示 */}
        {!isBinaryConflict && (
          <>
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
              {(conflictPromptContext || astContext) && (
                <Alert
                  type="info"
                  showIcon
                  icon={<WarningOutlined />}
                  message="已注入 AST 上下文"
                  description={conflictPromptContext || astContext}
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
              {resolved && <div className={styles['ig-conflict-applied']}>冲突已解决并已暂存</div>}

              {/* 解决操作按钮 — 直接写文件 + git add */}
              <div className={styles['ig-conflict-resolve-actions']}>
                <Button
                  loading={loading}
                  disabled={!ours || resolved}
                  onClick={() => void handleResolveConflict(ours, '保留 ours')}
                >
                  应用 ours
                </Button>
                <Button
                  loading={loading}
                  disabled={!theirs || resolved}
                  onClick={() => void handleResolveConflict(theirs, '保留 theirs')}
                >
                  应用 theirs
                </Button>
                {suggestion?.resolvedContent && (
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    loading={loading}
                    disabled={resolved}
                    onClick={() => void handleResolveConflict(suggestion.resolvedContent!, 'AI 智能合并')}
                  >
                    应用 AI 合并结果
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
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
