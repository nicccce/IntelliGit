import type { JSX, KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Empty, Input, List, Popconfirm, Tag, Typography } from 'antd'
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  HistoryOutlined,
  StopOutlined
} from '@ant-design/icons'

import SidePanelShell from '../../components/SidePanelShell'
import type {
  ConversationMessage,
  NlCommandPlan,
  NlpHistoryRecord,
} from '../../../../shared/types'
import { useGitStatusStore, useHistoryStore, useLlmConfigStore, useRepositoryStore } from '../../store'
import { selectAllCommitHistory } from '../../store/selectors/historySelectors'
import {
  selectBranches,
  selectCommitsAhead,
  selectCommitsBehind,
  selectCurrentBranch,
  selectFileStatuses,
  selectRemoteBranches
} from '../../store/selectors/gitStatusSelectors'
import { selectCurrentRepoPath } from '../../store/selectors/repositorySelectors'
import type { NlExecutionResult, RepoContext } from '../../services/nlCommandService'
import { applyNlSafetyPolicy, executeNlOperation, loadSafetyPolicy, parseNlCommand } from '../../services/nlCommandService'
import styles from './index.module.css'

const PROMPTS = [
  '撤销上一次提交',
  '推送到远程',
  '切换到新分支',
  '查看最近三天的提交记录',
  '合并 dev 分支',
  '暂存所有修改',
  '查看远程地址',
  '丢弃所有未暂存改动'
]

const RISK_TAG: Record<string, { color: string; label: string }> = {
  safe: { color: 'success', label: '安全' },
  high: { color: 'warning', label: '高危' },
  extreme: { color: 'error', label: '极高危' }
}

function commandText(op: { command: string; args?: string[] }): string {
  return `git ${op.command} ${(op.args ?? []).join(' ')}`.trim()
}

interface NlpPanelProps {
  isOpen: boolean
  onClose: () => void
}

function NlpPanel({ isOpen, onClose }: NlpPanelProps): JSX.Element | null {
  const [draft, setDraft] = useState('')
  const repoPath = useRepositoryStore(selectCurrentRepoPath)
  const currentBranch = useGitStatusStore(selectCurrentBranch)
  const llmConfig = useLlmConfigStore((s) => s.config)
  const localBranchInfos = useGitStatusStore(selectBranches)
  const remoteBranchInfos = useGitStatusStore(selectRemoteBranches)
  const commitsAhead = useGitStatusStore(selectCommitsAhead)
  const commitsBehind = useGitStatusStore(selectCommitsBehind)
  const fileStatuses = useGitStatusStore(selectFileStatuses)
  const allCommitHistory = useHistoryStore(selectAllCommitHistory)

  const [history, setHistory] = useState<NlpHistoryRecord[]>([])
  const [plan, setPlan] = useState<NlCommandPlan | null>(null)
  const [results, setResults] = useState<NlExecutionResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const repoCtx = useMemo((): RepoContext => {
    const staged = fileStatuses.filter((f) => f.staging !== ' ' && f.staging !== '?').length
    return {
      localBranches: localBranchInfos.map((b) => b.name),
      remoteBranches: remoteBranchInfos.map((b) => b.name),
      commitsAhead,
      commitsBehind,
      changedFiles: fileStatuses.length,
      stagedFiles: staged,
      recentCommits: allCommitHistory.slice(0, 5).map((c) => ({
        hash: c.hash,
        message: c.message.split('\n')[0]
      }))
    }
  }, [allCommitHistory, commitsAhead, commitsBehind, fileStatuses, localBranchInfos, remoteBranchInfos])

  const [showAllPrompts, setShowAllPrompts] = useState(false)
  const visiblePrompts = showAllPrompts ? PROMPTS : PROMPTS.slice(0, 2)

  const loadHistory = useCallback(async () => {
    setHistory(await window.electronAPI.nlp.getHistory())
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const appendHistory = useCallback(
    async (record: Omit<NlpHistoryRecord, 'timestamp'>) => {
      await window.electronAPI.nlp.appendHistory({ ...record, timestamp: new Date().toISOString() })
      await loadHistory()
    },
    [loadHistory]
  )

  const parseInput = useCallback(
    async (text: string) => {
      const input = text.trim()
      if (!input || loading) return
      setPlan(null)
      setResults([])
      setError(null)

      if (!repoPath) {
        setError('请先选择 Git 仓库')
        return
      }
      if (!llmConfig?.apiKey) {
        setError('请先在设置中配置 LLM API Key')
        return
      }

      setLoading(true)
      try {
        const policy = await loadSafetyPolicy()
        const parsed = await parseNlCommand(input, repoPath, currentBranch, llmConfig, [] as ConversationMessage[], repoCtx)
        if (!parsed) {
          setError('解析失败，请重新描述您的需求')
          return
        }
        const nextPlan = applyNlSafetyPolicy(parsed, policy)
        setPlan(nextPlan)

        const hasExtreme = nextPlan.operations.some((op) => op.riskLevel === 'extreme')
        const allSafe = nextPlan.operations.length > 0 && !nextPlan.requiresWorkflow && nextPlan.operations.every((op) => op.riskLevel === 'safe')
        if (hasExtreme) {
          await appendHistory({
            userInput: input,
            summary: nextPlan.summary,
            operations: nextPlan.operations,
            executionResults: [],
            blocked: true
          })
        } else if (allSafe) {
          await executePlan(nextPlan, input)
        }
      } catch (err) {
        setError(`调用失败：${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setLoading(false)
      }
    },
    [appendHistory, currentBranch, llmConfig, loading, repoCtx, repoPath]
  )

  const handleRun = useCallback(() => {
    void parseInput(draft)
  }, [draft, parseInput])

  const executePlan = useCallback(
    async (targetPlan: NlCommandPlan, sourceInput = draft) => {
      if (!repoPath) return
      setLoading(true)
      setError(null)
      try {
        const nextResults: NlExecutionResult[] = []
        for (const op of targetPlan.operations) {
          nextResults.push(await executeNlOperation(repoPath, op))
        }
        setResults(nextResults)
        await appendHistory({
          userInput: sourceInput.trim(),
          summary: targetPlan.summary,
          operations: targetPlan.operations,
          executionResults: nextResults,
          blocked: false
        })
      } finally {
        setLoading(false)
      }
    },
    [appendHistory, draft, repoPath]
  )

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleRun()
      }
    },
    [handleRun]
  )

  const hasExtreme = plan?.operations.some((op) => op.riskLevel === 'extreme') ?? false
  const hasHigh = plan?.operations.some((op) => op.riskLevel === 'high') ?? false

  if (!isOpen) return null

  return (
    <SidePanelShell title="自然语言 Git 助手" isOpen={isOpen} onClose={onClose} maxWidth={560}>
      <div className={styles.wrap}>
        <Input.TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="用自然语言描述 Git 操作…"
          autoSize={{ minRows: 3, maxRows: 6 }}
          disabled={loading}
        />
        <div className={styles.prompts}>
          {visiblePrompts.map((p) => (
            <Tag key={p} className={styles.prompt} onClick={() => { setDraft(p); void parseInput(p) }}>
              {p}
            </Tag>
          ))}
          {PROMPTS.length > 3 && (
            <Tag
              className={`${styles.prompt} ${styles.promptToggle}`}
              onClick={() => setShowAllPrompts((prev) => !prev)}
            >
              {showAllPrompts ? '收起' : `展开全部 (${PROMPTS.length})`}
            </Tag>
          )}
        </div>
        <Button type="primary" icon={<ArrowRightOutlined />} onClick={handleRun} disabled={!draft.trim() || loading} loading={loading}>
          解析
        </Button>

        {error && <div className={styles.error}>{error}</div>}

        {plan && (
          <section className={styles.plan}>
            <Typography.Title level={5}>{plan.summary}</Typography.Title>
            {plan.operations.map((op, index) => {
              const tag = RISK_TAG[op.riskLevel] ?? RISK_TAG.safe
              return (
                <div key={`${op.command}-${index}`} className={styles.operation}>
                  <div className={styles.operationHeader}>
                    <Tag color={tag.color}>{tag.label}</Tag>
                    <code>{commandText(op)}</code>
                  </div>
                  <p>{op.description}</p>
                  {op.riskReason && <p className={styles.risk}>{op.riskReason}</p>}
                  {op.riskLevel === 'extreme' && <p className={styles.blocked}><StopOutlined /> 极高危操作已阻止</p>}
                </div>
              )
            })}
            {!hasExtreme && plan.operations.length > 0 && (
              hasHigh ? (
                <Popconfirm
                  title="包含高危操作"
                  description="此操作将影响 Git 历史或远程，确认执行？"
                  okText="确认执行"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => executePlan(plan)}
                >
                  <Button danger loading={loading}>执行</Button>
                </Popconfirm>
              ) : (
                <Button type="primary" onClick={() => executePlan(plan)} loading={loading}>执行</Button>
              )
            )}
          </section>
        )}

        {results.length > 0 && (
          <section className={styles.results}>
            {results.map((item) => (
              <div key={item.command} className={styles.resultItem}>
                {item.success ? <CheckCircleOutlined className={styles.ok} /> : <CloseCircleOutlined className={styles.fail} />}
                <code>{item.command}</code>
                <pre>{item.output}</pre>
              </div>
            ))}
          </section>
        )}

        <div className={styles.historyHeader}>
          <HistoryOutlined /> <span>历史记录</span>
          <Button size="small" onClick={async () => { await window.electronAPI.nlp.clearHistory(); await loadHistory() }}>清空历史</Button>
        </div>
        <List
          locale={{ emptyText: <Empty description="暂无 NLP 操作历史" /> }}
          dataSource={history}
          renderItem={(item) => {
            const failed = item.executionResults.some((r) => !r.success)
            return (
              <List.Item>
                <div className={styles.historyItem}>
                  <div className={styles.historyMeta}>{new Date(item.timestamp).toLocaleString()}</div>
                  <div className={styles.historyInput}>{item.userInput}</div>
                  <div className={styles.historySummary}>{item.summary}</div>
                  <div className={styles.commands}>{item.operations.map(commandText).join('；')}</div>
                  <Tag color={item.blocked ? 'red' : failed ? 'orange' : 'green'}>
                    {item.blocked ? '已阻止' : failed ? '失败' : '成功'}
                  </Tag>
                </div>
              </List.Item>
            )
          }}
        />
      </div>
    </SidePanelShell>
  )
}

export default NlpPanel
