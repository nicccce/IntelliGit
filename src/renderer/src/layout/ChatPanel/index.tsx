import type { JSX } from 'react'
import { MessageOutlined } from '@ant-design/icons'

import SidePanelShell from '../../components/SidePanelShell'
import styles from './ChatPanel.module.css'

interface ChatPanelProps {
  isOpen: boolean
  onClose: () => void
}

function ChatPanel({ isOpen, onClose }: ChatPanelProps): JSX.Element | null {
  if (!isOpen) return null

  return (
    <SidePanelShell title="智能对话" isOpen={isOpen} onClose={onClose}>
      <div className={styles['ig-chat-placeholder']}>
        <MessageOutlined className={styles['ig-chat-placeholder-icon']} />
        <p>AI 对话功能即将上线</p>
        <p className={styles['ig-chat-placeholder-hint']}>此处将取代顶部工具栏中的聊天框</p>
      </div>
    </SidePanelShell>
  )
}

export default ChatPanel
