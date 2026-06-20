import type { JSX } from 'react'
import { useMemo, useState, useCallback, useEffect } from 'react'
import { Alert, Button, Card, Input, List, Popconfirm, Select, Tag, Typography } from 'antd'
import {
  CheckOutlined,
  RobotOutlined,
  BranchesOutlined,
  WarningOutlined,
  FileExclamationOutlined,
  SendOutlined
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
import { buildRuleBasedConflictSuggestion, suggestConflictResolution } from '../../services/conflictResolutionService'
import type { ConflictRiskReport } from '../../services/conflictRiskService'
import type { ConflictResolutionSuggestion } from '../../services/conflictResolutionService'
import styles from './ConflictPanel.module.css'

const { TextArea } = Input
const { Text } = Typography

interface ConflictPanelProps { isOpen: boolean; onClose: () => void }
const SAMPLE_HINT = '请选择存在冲突的文件，或粘贴 ancestor / ours / theirs 内容进行对比。'
type ConflictBlock = { ancestor: string; ours: string; theirs: string; resolved: boolean }
type ConflictFollowUp = { question: string; answer: string; createdAt: number }

type ConflictBlockSummary = { index: number; label: string; description: string; riskLevel: 'low' | 'medium' | 'high'; recommendedStrategy: 'take_ours' | 'take_theirs' | 'merge_both' | 'manual'; resolved: boolean }

function countNonEmptyLines(value: string): number { return value.split('\n').filter((line) => line.trim()).length }
function summarizeConflictBlock(block: ConflictBlock, index: number): ConflictBlockSummary {
  const oursLines = countNonEmptyLines(block.ours); const theirsLines = countNonEmptyLines(block.theirs); const ancestorLines = countNonEmptyLines(block.ancestor)
  const suggestion = buildRuleBasedConflictSuggestion({ filePath: `conflict-block-${index + 1}`, ancestor: block.ancestor, ours: block.ours, theirs: block.theirs })
  const riskLevel = suggestion.strategy === 'manual' || Math.max(oursLines, theirsLines) >= 24 ? 'high' : !ancestorLines || Math.abs(oursLines - theirsLines) >= 8 ? 'medium' : 'low'
  return { index, label: `冲突块 ${index + 1}`, description: `ours ${oursLines} 行 / theirs ${theirsLines} 行${ancestorLines ? ` / ancestor ${ancestorLines} 行` : ' / 无 ancestor'}`, riskLevel, recommendedStrategy: suggestion.strategy, resolved: block.resolved }
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
  const [activeConflictFile, setActiveConflictFile] = useState<string | null>(null)
  const [isBinaryConflict, setIsBinaryConflict] = useState(false)
  const [ancestor, setAncestor] = useState(''); const [ours, setOurs] = useState(''); const [theirs, setTheirs] = useState('')
  const [loading, setLoading] = useState(false); const [suggesting, setSuggesting] = useState(false)
  const [suggestion, setSuggestion] = useState<ConflictResolutionSuggestion | null>(null)
  const [riskReport, setRiskReport] = useState<ConflictRiskReport | null>(null)
  const [blocks, setBlocks] = useState<ConflictBlock[]>([])
  const [activeBlockIndex, setActiveBlockIndex] = useState(0)
  const [followUps, setFollowUps] = useState<ConflictFollowUp[]>([])
  const [followUpQuestion, setFollowUpQuestion] = useState('')
  const [pendingStageFile, setPendingStageFile] = useState<string | null>(null)

  useEffect(() => { if (!isOpen) return; void (async () => { try { const status = await invokeGit('merge.status'); setMerging(!!status.merging); setConflictedFiles(status.conflictedFiles ?? []) } catch {} })() }, [isOpen])
  const effectiveFilePath = activeConflictFile ?? selectedFilePath
  const diff = diffSource === 'staged' ? stagedDiff : workdirDiff
  const diffText = (diff as { diff?: string } | null)?.diff ?? ''
  const hasConflictFile = useMemo(() => conflictedFiles.includes(effectiveFilePath || ''), [conflictedFiles, effectiveFilePath])
  const selectedFileSummary = useMemo(() => effectiveFilePath ? `当前文件：${effectiveFilePath}` : SAMPLE_HINT, [effectiveFilePath])
  const currentBlock = blocks[activeBlockIndex]
  const blockSummaries = useMemo(() => blocks.map((block, index) => summarizeConflictBlock(block, index)), [blocks])
  const activeBlockSummary = blockSummaries[activeBlockIndex]
  const resolvedCount = useMemo(() => blocks.filter((block) => block.resolved).length, [blocks])
  const [astContext, setAstContext] = useState<string | undefined>()
  const [conflictPromptContext, setConflictPromptContext] = useState<string | undefined>()

  useEffect(() => { let cancelled = false; async function loadAstContext() { if (!effectiveFilePath || !diffText) { setAstContext(undefined); setConflictPromptContext(undefined); return } const [nextAstContext, nextConflictPromptContext] = await Promise.all([renderAstContext([effectiveFilePath], diffText), buildConflictAnalysisContext([effectiveFilePath], diffText)]); if (!cancelled) { setAstContext(nextAstContext); setConflictPromptContext(nextConflictPromptContext) } } void loadAstContext(); return () => { cancelled = true } }, [diffText, effectiveFilePath])

  const refreshConflictStatus = useCallback(async () => { const status = await invokeGit('merge.status'); setMerging(!!status.merging); setConflictedFiles(status.conflictedFiles ?? []) }, [])
  const handleSelectRiskFile = useCallback(async (filePath: string) => { await useDiffStore.getState().selectFile(filePath, 'unstaged') }, [])
  const suggestionText = useMemo(() => { const fileName = effectiveFilePath?.split(/[\\/]/).pop() || 'unknown'; if (suggestion) return suggestion.explanation; if (!currentBlock) return `AI 建议：先载入冲突三方内容，再判断 ${fileName} 的合并策略。`; if ((currentBlock.ours || currentBlock.theirs) && !currentBlock.ancestor) return 'AI 建议：优先对比 ours 与 theirs；如果一侧明显是补充逻辑，可考虑 merge_both。'; return 'AI 建议：结合 ancestor 判断变更来源，避免把双方独立改动覆盖掉。' }, [currentBlock, effectiveFilePath, suggestion])

  const handleSuggest = useCallback(async () => { if (!effectiveFilePath) return; setSuggesting(true); try { const source = currentBlock ?? { ancestor, ours, theirs, resolved: false }; const nextSuggestion = await suggestConflictResolution(llmConfig, { filePath: effectiveFilePath, ancestor: source.ancestor, ours: source.ours, theirs: source.theirs, context: conflictPromptContext || astContext }); setSuggestion(nextSuggestion); useUiStore.getState().showSuccess(nextSuggestion.fallback ? '已生成规则化冲突建议' : '已生成 AI 冲突建议') } catch (error) { useUiStore.getState().setError(error instanceof Error ? error.message : String(error)) } finally { setSuggesting(false) } }, [ancestor, astContext, conflictPromptContext, currentBlock, effectiveFilePath, llmConfig, ours, theirs])

  const handleStartMerge = useCallback(async () => { if (!mergeBranch || !repoPath) return; setLoading(true); try { await window.electronAPI.executeGitCommand({ repoPath, args: ['merge', '--no-edit', mergeBranch] }); useUiStore.getState().showSuccess(`已成功合并 ${mergeBranch}`); setMerging(false); setConflictedFiles([]) } catch { await refreshConflictStatus(); useUiStore.getState().showSuccess('合并产生冲突，请逐一解决') } finally { setLoading(false) } }, [mergeBranch, refreshConflictStatus, repoPath])
  const handleFinishMerge = useCallback(async () => { setLoading(true); try { await invokeGit('merge.continue', {}); setMerging(false); setConflictedFiles([]); setActiveConflictFile(null); setBlocks([]); useUiStore.getState().showSuccess('合并提交已创建，分支合并完成！') } catch (error) { useUiStore.getState().setError(error instanceof Error ? error.message : String(error)) } finally { setLoading(false) } }, [])

  const writeResolvedFile = useCallback(async (content: string, label: string) => {
    if (!activeConflictFile || !repoPath || !content.trim()) return
    setLoading(true)
    try {
      const filePath = `${repoPath.replace(/[\\/]$/, '')}/${activeConflictFile}`
      const result = await window.electronAPI.writeFile({ filePath, content })
      if (!result.success) throw new Error(result.error || '写入文件失败')
      setBlocks((prev) => prev.map((block, index) => index === activeBlockIndex ? { ...block, resolved: true } : block))
      setSuggestion((prev) => prev ? { ...prev, resolvedContent: content } : prev)
      setPendingStageFile(activeConflictFile)
      useUiStore.getState().showSuccess('已写入文件')
      await refreshConflictStatus()
      await invokeGit('staging.status')
      const files = (await invokeGit('merge.status')).conflictedFiles ?? []
      if (files.length === 0) useUiStore.getState().showSuccess('所有冲突已解决！可点击立即合并')
      useUiStore.getState().showSuccess(`已应用「${label}」`)
    } catch (error) { useUiStore.getState().setError(error instanceof Error ? error.message : String(error)) } finally { setLoading(false) }
  }, [activeBlockIndex, activeConflictFile, refreshConflictStatus, repoPath])

  const handleStageResolvedFile = useCallback(async () => {
    if (!pendingStageFile) return
    setLoading(true)
    try {
      await invokeGit('staging.add', { path: pendingStageFile })
      await useGitStatusStore.getState().refreshStatus()
      await invokeGit('staging.status')
      setPendingStageFile(null)
      useUiStore.getState().showSuccess('已自动暂存文件')
    } catch (error) { useUiStore.getState().setError(error instanceof Error ? error.message : String(error)) } finally { setLoading(false) }
  }, [pendingStageFile])

  const handleLoadConflictFile = useCallback(async (filePath: string) => { setLoading(true); setActiveConflictFile(filePath); setPendingStageFile(null); setSuggestion(null); setIsBinaryConflict(false); setBlocks([]); setRiskReport(null); try { const stage = await invokeGit('merge.stageContent', { path: filePath }); if (stage.binary) { setIsBinaryConflict(true); setAncestor(''); setOurs(''); setTheirs(''); useUiStore.getState().showSuccess('二进制冲突文件，请选择保留哪一侧'); return } setAncestor(stage.ancestor); setOurs(stage.ours); setTheirs(stage.theirs); setActiveBlockIndex(0); const syntheticBlock: ConflictBlock = { ancestor: stage.ancestor, ours: stage.ours, theirs: stage.theirs, resolved: false }; setBlocks([syntheticBlock]); setRiskReport(await buildConflictRiskReport([filePath], stage.ours + stage.theirs)); useUiStore.getState().showSuccess('已载入冲突文件三方内容') } catch (error) { useUiStore.getState().setError(error instanceof Error ? error.message : String(error)) } finally { setLoading(false) } }, [])
  const handleResolveBinary = useCallback(async (side: 'ours' | 'theirs') => { if (!activeConflictFile || !repoPath) return; setLoading(true); try { await window.electronAPI.executeGitCommand({ repoPath, args: ['checkout', `--${side}`, activeConflictFile] }); await window.electronAPI.executeGitCommand({ repoPath, args: ['add', activeConflictFile] }); await refreshConflictStatus(); useUiStore.getState().showSuccess(`已保留 ${side} 版本，冲突标记为已解决`); setIsBinaryConflict(false); setActiveConflictFile(null) } catch (error) { useUiStore.getState().setError(error instanceof Error ? error.message : String(error)) } finally { setLoading(false) } }, [activeConflictFile, refreshConflictStatus, repoPath])
  const handleLoadConflict = useCallback(async () => { setLoading(true); try { const status = await invokeGit('merge.status'); setMerging(!!status.merging); const files: string[] = status.conflictedFiles ?? []; setConflictedFiles(files); const target = files[0] ?? effectiveFilePath; if (!target) { useUiStore.getState().showSuccess(files.length ? '检测到冲突文件，请点击选择' : '当前没有检测到 merge 冲突'); return } await handleLoadConflictFile(target) } catch (error) { useUiStore.getState().setError(error instanceof Error ? error.message : String(error)) } finally { setLoading(false) } }, [effectiveFilePath, handleLoadConflictFile])
  const handleAskFollowUp = useCallback(async () => { const question = followUpQuestion.trim(); if (!question || !effectiveFilePath) return; setSuggesting(true); try { const source = currentBlock ?? { ancestor, ours, theirs, resolved: false }; const history = followUps.map((item) => `Q: ${item.question}\nA: ${item.answer}`).join('\n\n'); const prompt = `追问：${question}\n\n当前建议：${suggestionText}\n\n历史对话：\n${history || '无'}\n\nancestor:\n${source.ancestor}\n\nours:\n${source.ours}\n\ntheirs:\n${source.theirs}`; const nextSuggestion = await suggestConflictResolution(llmConfig, { filePath: effectiveFilePath, ancestor: source.ancestor, ours: source.ours, theirs: source.theirs, context: [conflictPromptContext, astContext, prompt].filter(Boolean).join('\n\n') }); setSuggestion(nextSuggestion); setFollowUps((prev) => [...prev, { question, answer: nextSuggestion.explanation, createdAt: Date.now() }]); setFollowUpQuestion('') } catch (error) { useUiStore.getState().setError(error instanceof Error ? error.message : String(error)) } finally { setSuggesting(false) } }, [ancestor, astContext, conflictPromptContext, currentBlock, effectiveFilePath, followUps, followUpQuestion, llmConfig, ours, suggestionText, theirs])

  if (!isOpen) return null
  return (<SidePanelShell title="冲突 AI 建议" isOpen={isOpen} onClose={onClose} maxWidth={720}><div className={styles['ig-conflict-panel']}><div className={styles['ig-conflict-meta']}><Tag color="blue"><BranchesOutlined /> 三栏对比</Tag><span>{selectedFileSummary}</span>{hasConflictFile && <Tag color="red">冲突文件</Tag>}{merging && blocks.length > 0 && <Tag color="gold">已解决 {resolvedCount}/{blocks.length} 个冲突块</Tag>}{merging && conflictedFiles.length > 0 && <Tag color="gold">{`${conflictedFiles.length} 个冲突文件`}</Tag>}{merging && conflictedFiles.length === 0 && <Tag color="green">已解决所有冲突</Tag>}{!merging && <Tag>未处于合并状态</Tag>}</div>
      {!merging && <div className={styles['ig-conflict-start-bar']}><span className={styles['ig-conflict-start-hint']}>选择要合并到 <strong>{currentBranch}</strong> 的分支：</span><Select placeholder="选择分支" value={mergeBranch} onChange={setMergeBranch} className={styles['ig-conflict-branch-select']} options={allBranches.filter((b) => b.name !== currentBranch).map((b) => ({ value: b.name, label: b.name }))}/><Button type="primary" loading={loading} disabled={!mergeBranch} onClick={() => void handleStartMerge()}>开始合并</Button></div>}
      {merging && conflictedFiles.length === 0 && <div className={styles['ig-conflict-finish-bar']}><span className={styles['ig-conflict-finish-hint']}>所有冲突已解决，点击右侧按钮完成合并并创建提交</span><Button type="primary" icon={<CheckOutlined />} loading={loading} onClick={() => void handleFinishMerge()}>立即合并</Button></div>}
      {merging && conflictedFiles.length > 0 && <div className={styles['ig-conflict-file-list']}>{conflictedFiles.map((f) => <div key={f} className={classNames(styles['ig-conflict-file-item'], activeConflictFile === f && styles['ig-conflict-file-item-active'])} onClick={() => void handleLoadConflictFile(f)}><WarningOutlined className={styles['ig-conflict-file-icon']} /><span className={styles['ig-conflict-file-name']}>{f}</span></div>)}</div>}
      <div className={styles['ig-conflict-strategy']}><Button loading={loading} onClick={() => void handleLoadConflict()}>刷新冲突列表</Button>{!isBinaryConflict && <Button icon={<RobotOutlined />} loading={suggesting} onClick={() => void handleSuggest()} disabled={!ours && !theirs}>生成 AI 建议</Button>}</div>
      {riskReport && <Card size="small" title="语义风险地图" className={styles['ig-conflict-risk-card']}><div className={styles['ig-conflict-risk-summary']}>{riskReport.summary}</div><List size="small" dataSource={riskReport.files} locale={{ emptyText: '暂无文件级语义风险' }} renderItem={(file) => <List.Item className={styles['ig-conflict-risk-item']} actions={[<Button key="jump" size="small" onClick={() => void handleSelectRiskFile(file.filePath)}>跳转</Button>]}><List.Item.Meta title={<div className={styles['ig-conflict-risk-title']}><Tag color={file.level === 'high' ? 'red' : file.level === 'medium' ? 'gold' : 'green'}>{file.level}</Tag><span>{file.filePath}</span></div>} description={<div className={styles['ig-conflict-risk-desc']}><div>{formatFileRiskTitle(file)}</div>{file.reasons.slice(0, 2).map((reason) => <div key={reason}>{reason}</div>)}</div>} /></List.Item>} /></Card>}
      {isBinaryConflict && activeConflictFile && <Card size="small" className={styles['ig-conflict-binary-card']} title={<span><FileExclamationOutlined style={{ color: 'var(--accent-red)', marginRight: 6 }} />二进制 / 新增冲突文件</span>}><div className={styles['ig-conflict-binary-desc']}><p><strong>{activeConflictFile}</strong> 是二进制文件或双方均为新增——Git 无法自动合并，只能保留其中一侧。</p><p>选择后将自动执行 <code>git checkout --ours/--theirs</code> 并 <code>git add</code> 标记已解决。</p></div><div className={styles['ig-conflict-binary-actions']}><Button type="primary" loading={loading} onClick={() => void handleResolveBinary('ours')}>保留 ours（当前分支）</Button><Button danger loading={loading} onClick={() => void handleResolveBinary('theirs')}>保留 theirs（被合并分支）</Button></div></Card>}
      {blocks.length > 0 && <Card size="small" className={styles['ig-conflict-block-card']} title="冲突块导航"><div className={styles['ig-conflict-block-toolbar']}><Tag color="geekblue">已识别 {blocks.length} 个冲突块</Tag>{activeBlockSummary && <><Tag color={activeBlockSummary.riskLevel === 'high' ? 'red' : activeBlockSummary.riskLevel === 'medium' ? 'gold' : 'green'}>{activeBlockSummary.riskLevel} risk</Tag><Tag color="blue">建议：{activeBlockSummary.recommendedStrategy}</Tag></> }<Select value={activeBlockIndex} onChange={(value) => { setActiveBlockIndex(value); const next = blocks[value]; if (next) { setAncestor(next.ancestor); setOurs(next.ours); setTheirs(next.theirs); setSuggestion(null) } }} options={blockSummaries.map((summary) => ({ value: summary.index, label: `${summary.label}${summary.resolved ? ' ✅ 已解决' : ''} · ${summary.riskLevel}` }))}/></div><List size="small" dataSource={blockSummaries} renderItem={(summary) => <List.Item className={classNames(styles['ig-conflict-block-item'], summary.index === activeBlockIndex && styles['ig-conflict-block-item-active'])} onClick={() => { setActiveBlockIndex(summary.index); const next = blocks[summary.index]; if (next) { setAncestor(next.ancestor); setOurs(next.ours); setTheirs(next.theirs); setSuggestion(null) } }}><List.Item.Meta title={<div className={styles['ig-conflict-risk-title']}><Tag color={summary.riskLevel === 'high' ? 'red' : summary.riskLevel === 'medium' ? 'gold' : 'green'}>{summary.riskLevel}</Tag><span>{summary.resolved ? '✅ 已解决' : summary.label}</span><Tag color="blue">{summary.recommendedStrategy}</Tag></div>} description={summary.description} /></List.Item>} /></Card>}
      {!isBinaryConflict && <><div className={styles['ig-conflict-grid']}><CompareColumn title="ancestor" value={ancestor} onChange={setAncestor} placeholder="粘贴共同祖先内容" /><CompareColumn title="ours" value={ours} onChange={setOurs} placeholder="粘贴当前分支内容" /><CompareColumn title="theirs" value={theirs} onChange={setTheirs} placeholder="粘贴目标分支内容" /></div><div className={styles['ig-conflict-suggestion']}><div className={styles['ig-conflict-suggestion-title']}><CheckOutlined /> AI 建议{suggestion?.fallback && <Tag color="gold">规则降级</Tag>}{suggestion && <Tag color="blue">{suggestion.strategy}</Tag>}</div>{(conflictPromptContext || astContext) && <Alert type="info" showIcon icon={<WarningOutlined />} message="已注入 AST 上下文" description={conflictPromptContext || astContext} className={styles['ig-conflict-ast-context']} />}<div className={styles['ig-conflict-suggestion-body']}>{suggestionText}</div>{suggestion?.warnings?.map((warning) => <div key={warning} className={styles['ig-conflict-warning']}>{warning}</div>)}{suggestion?.resolvedContent && <TextArea value={suggestion.resolvedContent} readOnly rows={8} className={styles['ig-conflict-resolved']} />}{suggestion?.resolvedContent && <div className={styles['ig-conflict-copy-row']}><Button onClick={() => void navigator.clipboard.writeText(suggestion.resolvedContent || '')}>复制建议内容</Button><Popconfirm title="将写入文件" description="确定采纳该建议吗？" okText="一键采纳建议" cancelText="取消" onConfirm={() => void writeResolvedFile(suggestion.resolvedContent!, 'AI 智能合并')}><Button type="primary" icon={<CheckOutlined />} loading={loading} disabled={!suggestion.resolvedContent}>一键采纳建议</Button></Popconfirm></div>}{resolvedCount > 0 && <div className={styles['ig-conflict-applied']}>已写入文件</div>}{pendingStageFile && <Alert type="success" showIcon message="已写入文件" description={<div>是否自动暂存该文件？<Button size="small" type="primary" loading={loading} onClick={() => void handleStageResolvedFile()} style={{ marginLeft: 8 }}>自动暂存</Button><Button size="small" onClick={() => setPendingStageFile(null)} style={{ marginLeft: 8 }}>稍后处理</Button></div>} />}
<div className={styles['ig-conflict-resolve-actions']}><Button loading={loading} disabled={!ours} onClick={() => void writeResolvedFile(ours, '保留 ours')}>应用 ours</Button><Button loading={loading} disabled={!theirs} onClick={() => void writeResolvedFile(theirs, '保留 theirs')}>应用 theirs</Button>{suggestion?.resolvedContent && <Button type="primary" icon={<CheckOutlined />} loading={loading} onClick={() => void writeResolvedFile(suggestion.resolvedContent!, 'AI 智能合并结果')}>应用 AI 合并结果</Button>}</div><div className={styles['ig-conflict-followup']}><Text strong>追问历史</Text><List size="small" dataSource={followUps} locale={{ emptyText: '暂无追问记录' }} renderItem={(item) => <List.Item><div><div>{item.question}</div><Text type="secondary">{item.answer}</Text></div></List.Item>} /><Input value={followUpQuestion} onChange={(e) => setFollowUpQuestion(e.target.value)} placeholder="为什么不保留 theirs 的版本？" suffix={<Button type="link" icon={<SendOutlined />} loading={suggesting} onClick={() => void handleAskFollowUp()}>发送</Button>} /></div></div></>}</div></SidePanelShell>)
}

function CompareColumn({ title, value, onChange, placeholder }: { title: string; value: string; onChange: (value: string) => void; placeholder: string }): JSX.Element {
  return <div className={styles['ig-conflict-column']}><div className={classNames(styles['ig-conflict-column-title'])}>{title}</div><TextArea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={14} /></div>
}

export default ConflictPanel
