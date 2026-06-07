import type { JSX, KeyboardEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Popconfirm, Spin, Tag } from 'antd'
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  SendOutlined,
  StopOutlined
} from '@ant-design/icons'

import SidePanelShell from '../../components/SidePanelShell'
import { useGitStatusStore, useLlmConfigStore, useRepositoryStore } from '../../store'
import { selectCurrentRepoPath } from '../../store/selectors/repositorySelectors'
import { selectCurrentBranch } from '../../store/selectors/gitStatusSelectors'
import type { NlCommandPlan } from '../../../../shared/types'
import type { NlExecutionResult } from '../../services/nlCommandService'
import { executeNlOperation, parseNlCommand } from '../../services/nlCommandService'
import styles from './ChatPanel.module.css'

interface ChatPanelProps {
  isOpen: boolean
  onClose: () => void
}

type MessageRole = 'user' | 'assistant'

interface ChatMessage {
  id: string
  role: MessageRole
  text: string
  plan?: NlCommandPlan
  executionLog?: NlExecutionResult[]
  isLoading?: boolean
  error?: string
}

let msgIdCounter = 0
function nextId(): string {
  return String(++msgIdCounter)
}

const RISK_TAG: Record<string, { color: string; label: string }> = {
  safe: { color: 'success', label: '安全' },
  high: { color: 'warning', label: '高危' },
  extreme: { color: 'error', label: '极高危' }
}

function ChatPanel({ isOpen, onClose }: ChatPanelProps): JSX.Element | null {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const repoPath = useRepositoryStore(selectCurrentRepoPath)
  const currentBranch = useGitStatusStore(selectCurrentBranch)
  const llmConfig = useLlmConfigStore((s) => s.config)

  // 滚动到最新消息
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  const updateMessage = useCallback(
    (id: string, patch: Partial<ChatMessage>) =>
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m))),
    []
  )

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { id: nextId(), role: 'user', text }
    const assistantId = nextId()
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', text: '', isLoading: true }

    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setInput('')
    setLoading(true)

    try {
      if (!repoPath) {
        updateMessage(assistantId, { isLoading: false, error: '请先在左侧选择一个仓库' })
        return
      }
      if (!llmConfig?.apiKey) {
        updateMessage(assistantId, { isLoading: false, error: '请先在设置中配置 LLM API Key' })
        return
      }

      const plan = await parseNlCommand(text, repoPath, currentBranch, llmConfig)

      if (!plan) {
        updateMessage(assistantId, { isLoading: false, error: '解析失败，请重新描述您的需求' })
        return
      }

      updateMessage(assistantId, { isLoading: false, text: plan.summary, plan })
    } catch (err) {
      updateMessage(assistantId, {
        isLoading: false,
        error: `调用失败：${err instanceof Error ? err.message : String(err)}`
      })
    } finally {
      setLoading(false)
    }
  }, [input, loading, repoPath, currentBranch, llmConfig, updateMessage])

  const handleExecute = useCallback(
    async (messageId: string, plan: NlCommandPlan) => {
      if (!repoPath) return

      const results: NlExecutionResult[] = []
      for (const op of plan.operations) {
        const result = await executeNlOperation(repoPath, op)
        results.push(result)
      }
      updateMessage(messageId, { executionLog: results })
    },
    [repoPath, updateMessage]
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
                  {msg.text && <p className={styles['ig-chat-text']}>{msg.text}</p>}

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
