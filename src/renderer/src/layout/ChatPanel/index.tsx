import type { JSX, KeyboardEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button, Input, Popconfirm, Spin, Tag, Tooltip } from 'antd'
import {
  CheckCircleOutlined,
  ClearOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  SendOutlined,
  StopOutlined
} from '@ant-design/icons'

import SidePanelShell from '../../components/SidePanelShell'
import { useChatStore, useGitStatusStore, useHistoryStore, useLlmConfigStore, useRepositoryStore } from '../../store'
import type { ChatMessage } from '../../store/chatStore'
import { selectCurrentRepoPath } from '../../store/selectors/repositorySelectors'
import {
  selectBranches,
  selectCommitsAhead,
  selectCommitsBehind,
  selectCurrentBranch,
  selectFileStatuses,
  selectRemoteBranches
} from '../../store/selectors/gitStatusSelectors'
import { selectAllCommitHistory } from '../../store/selectors/historySelectors'
import { nextMsgId } from '../../store/chatStore'
import type { NlCommandPlan, ConversationMessage } from '../../../../shared/types'
import type { NlExecutionResult, RepoContext } from '../../services/nlCommandService'
import { applyNlSafetyPolicy, executeNlOperation, interpretGitOutput, loadSafetyPolicy, parseNlCommand } from '../../services/nlCommandService'
import styles from './ChatPanel.module.css'

// 稳定的空数组引用，避免 Zustand selector 每次返回新 [] 导致无限循环
const EMPTY_MESSAGES: ChatMessage[] = []

interface ChatPanelProps {
  isOpen: boolean
  onClose: () => void
}

const RISK_TAG: Record<string, { color: string; label: string }> = {
  safe: { color: 'success', label: '安全' },
  high: { color: 'warning', label: '高危' },
  extreme: { color: 'error', label: '极高危' }
}

function ChatPanel({ isOpen, onClose }: ChatPanelProps): JSX.Element | null {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const addMessages = useChatStore((s) => s.addMessages)
  const updateMessage = useChatStore((s) => s.updateMessage)
  const clearMessages = useChatStore((s) => s.clearMessages)

  const repoPath = useRepositoryStore(selectCurrentRepoPath)
  const currentBranch = useGitStatusStore(selectCurrentBranch)
  const llmConfig = useLlmConfigStore((s) => s.config)
  const localBranchInfos = useGitStatusStore(selectBranches)
  const remoteBranchInfos = useGitStatusStore(selectRemoteBranches)
  const commitsAhead = useGitStatusStore(selectCommitsAhead)
  const commitsBehind = useGitStatusStore(selectCommitsBehind)
  const fileStatuses = useGitStatusStore(selectFileStatuses)
  const allCommitHistory = useHistoryStore(selectAllCommitHistory)

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
  }, [localBranchInfos, remoteBranchInfos, commitsAhead, commitsBehind, fileStatuses, allCommitHistory])

  // 订阅当前仓库的消息列表，切换仓库时自动更新
  // 必须用模块级常量做 fallback，避免每次返回新 [] 引发无限渲染循环
  const messages = useChatStore((s) => s.messagesByRepo[repoPath ?? ''] ?? EMPTY_MESSAGES)

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsgId = nextMsgId()
    const assistantId = nextMsgId()

    if (!repoPath) {
      // 没有仓库时仅提示，不写入任何消息
      return
    }

    addMessages(repoPath, [
      { id: userMsgId, role: 'user', text },
      { id: assistantId, role: 'assistant', text: '', isLoading: true }
    ])
    setInput('')
    setLoading(true)

    try {
      if (!llmConfig?.apiKey) {
        updateMessage(repoPath, assistantId, { isLoading: false, error: '请先在设置中配置 LLM API Key' })
        return
      }

      // 构建历史上下文：助手消息用原始 JSON plan（与 LLM 实际输出格式一致），
      // 用户消息用 text；过滤掉 loading / error 状态的消息
      const history: ConversationMessage[] = messages
        .filter((m) => !m.isLoading && !m.error && m.text)
        .map((m) => ({
          role: m.role,
          content: m.role === 'assistant' && m.plan ? JSON.stringify(m.plan) : m.text
        }))

      const parsedPlan = await parseNlCommand(text, repoPath, currentBranch, llmConfig, history, repoCtx)

      if (!parsedPlan) {
        updateMessage(repoPath, assistantId, { isLoading: false, error: '解析失败，请重新描述您的需求' })
        return
      }

      const plan = applyNlSafetyPolicy(parsedPlan, await loadSafetyPolicy())

      // 全部为安全操作且无需工作流时，自动执行并用 LLM 解读结果
      const allSafe =
        plan.operations.length > 0 &&
        !plan.requiresWorkflow &&
        plan.operations.every((op) => op.riskLevel === 'safe')

      if (allSafe) {
        updateMessage(repoPath, assistantId, { text: '执行中…' })
        const results: NlExecutionResult[] = []
        for (const op of plan.operations) {
          results.push(await executeNlOperation(repoPath, op))
        }
        const answer = await interpretGitOutput(text, results, llmConfig)
        updateMessage(repoPath, assistantId, {
          isLoading: false,
          text: answer ?? plan.summary,
          executionLog: results
        })
      } else {
        // 高危/需确认操作：展示计划，等待用户点击执行
        updateMessage(repoPath, assistantId, { isLoading: false, text: plan.summary, plan })
      }
    } catch (err) {
      updateMessage(repoPath, assistantId, {
        isLoading: false,
        error: `调用失败：${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      setLoading(false)
    }
  }, [input, loading, repoPath, currentBranch, llmConfig, messages, repoCtx, addMessages, updateMessage])

  const handleExecute = useCallback(
    async (messageId: string, plan: NlCommandPlan) => {
      if (!repoPath) return

      const results: NlExecutionResult[] = []
      for (const op of plan.operations) {
        results.push(await executeNlOperation(repoPath, op))
      }
      updateMessage(repoPath, messageId, { executionLog: results })

      // 执行完毕后，用 LLM 追加一条自然语言解读消息
      if (llmConfig?.apiKey) {
        const msgIndex = messages.findIndex((m) => m.id === messageId)
        const prevUser = msgIndex > 0 ? messages[msgIndex - 1] : null
        const originalQuestion = prevUser?.role === 'user' ? prevUser.text : plan.intent ?? ''

        const interpId = nextMsgId()
        addMessages(repoPath, [{ id: interpId, role: 'assistant', text: '', isLoading: true }])
        const answer = await interpretGitOutput(originalQuestion, results, llmConfig)
        updateMessage(repoPath, interpId, {
          isLoading: false,
          text: answer ?? '操作已完成'
        })
      }
    },
    [repoPath, llmConfig, messages, addMessages, updateMessage]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  if (!isOpen) return null

  return (
    <SidePanelShell title="智能 Git 助手" isOpen={isOpen} onClose={onClose} maxWidth={560}>
      <div className={styles['ig-chat-container']}>
        {/* 消息列表 */}
        <div className={styles['ig-chat-messages']} ref={listRef}>
          {messages.length === 0 && (
            <div className={styles['ig-chat-empty']}>
              <p>用自然语言描述 Git 操作需求</p>
              <p className={styles['ig-chat-hint']}>
                例如：「撤销上一次提交」「查看最近三天的提交记录」
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={
                msg.role === 'user'
                  ? styles['ig-chat-msg-user']
                  : styles['ig-chat-msg-assistant']
              }
            >
              {msg.isLoading ? (
                <Spin indicator={<LoadingOutlined spin />} size="small" />
              ) : msg.error ? (
                <span className={styles['ig-chat-error']}>{msg.error}</span>
              ) : (
                <>
                  {msg.text && (
                    <div className={styles['ig-chat-text']}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                    </div>
                  )}

                  {msg.plan && msg.plan.operations.length > 0 && !msg.executionLog && (
                    <OperationPlan
                      messageId={msg.id}
                      plan={msg.plan}
                      onExecute={handleExecute}
                    />
                  )}

                  {msg.executionLog && (
                    <ExecutionLog results={msg.executionLog} />
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        {/* 输入区域 */}
        <div className={styles['ig-chat-input-area']}>
          <Tooltip title="清空对话">
            <Button
              icon={<ClearOutlined />}
              onClick={() => repoPath && clearMessages(repoPath)}
              disabled={messages.length === 0 || loading}
              className={styles['ig-chat-clear-btn']}
            />
          </Tooltip>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述您的 Git 需求，按 Enter 发送…"
            disabled={loading}
            className={styles['ig-chat-input']}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            disabled={!input.trim() || loading}
            loading={loading}
          />
        </div>
      </div>
    </SidePanelShell>
  )
}

// ─── 操作计划展示 ──────────────────────────────────────────────────────────────

interface OperationPlanProps {
  messageId: string
  plan: NlCommandPlan
  onExecute: (messageId: string, plan: NlCommandPlan) => void
}

function OperationPlan({ messageId, plan, onExecute }: OperationPlanProps): JSX.Element {
  const hasExtreme = plan.operations.some((op) => op.riskLevel === 'extreme')
  const hasHigh = plan.operations.some((op) => op.riskLevel === 'high')

  const executeButton = hasExtreme ? null : hasHigh ? (
    <Popconfirm
      title="包含高危操作"
      description="此操作将影响 Git 历史或远程，确认执行？"
      onConfirm={() => onExecute(messageId, plan)}
      okText="确认执行"
      cancelText="取消"
      okButtonProps={{ danger: true }}
    >
      <Button size="small" danger>
        执行
      </Button>
    </Popconfirm>
  ) : (
    <Button size="small" type="primary" onClick={() => onExecute(messageId, plan)}>
      执行
    </Button>
  )

  return (
    <div className={styles['ig-chat-plan']}>
      <p className={styles['ig-chat-plan-label']}>将执行以下操作：</p>
      {plan.operations.map((op, i) => {
        const tag = RISK_TAG[op.riskLevel] ?? RISK_TAG.safe
        const cmd = `git ${op.command} ${(op.args ?? []).join(' ')}`.trim()
        return (
          <div key={i} className={styles['ig-chat-op']}>
            <div className={styles['ig-chat-op-header']}>
              <Tag color={tag.color}>{tag.label}</Tag>
              <code className={styles['ig-chat-op-cmd']}>{cmd}</code>
            </div>
            <p className={styles['ig-chat-op-desc']}>{op.description}</p>
            {op.riskLevel === 'extreme' && (
              <p className={styles['ig-chat-op-blocked']}>
                <StopOutlined /> 极高危操作已阻止，请手动在终端执行
              </p>
            )}
            {op.riskReason && op.riskLevel !== 'safe' && (
              <p className={styles['ig-chat-op-risk']}>{op.riskReason}</p>
            )}
          </div>
        )
      })}
      {executeButton && <div className={styles['ig-chat-plan-footer']}>{executeButton}</div>}
    </div>
  )
}

// ─── 执行结果展示 ──────────────────────────────────────────────────────────────

function ExecutionLog({ results }: { results: NlExecutionResult[] }): JSX.Element {
  return (
    <div className={styles['ig-chat-exec-log']}>
      {results.map((r, i) => (
        <div key={i} className={styles['ig-chat-exec-item']}>
          <div className={styles['ig-chat-exec-header']}>
            {r.success ? (
              <CheckCircleOutlined className={styles['ig-chat-exec-ok']} />
            ) : (
              <CloseCircleOutlined className={styles['ig-chat-exec-fail']} />
            )}
            <code>{r.command}</code>
          </div>
          {r.output && <pre className={styles['ig-chat-exec-output']}>{r.output}</pre>}
        </div>
      ))}
    </div>
  )
}

export default ChatPanel
