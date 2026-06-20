import { create } from 'zustand'

import type { NlCommandPlan } from '../../../shared/types'
import type { NlExecutionResult } from '../services/nlCommandService'

export type MessageRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: MessageRole
  text: string
  plan?: NlCommandPlan
  executionLog?: NlExecutionResult[]
  isLoading?: boolean
  error?: string
}

interface ChatStoreState {
  /** 按 repoPath 分组的消息列表 */
  messagesByRepo: Record<string, ChatMessage[]>
  getMessages: (repoPath: string) => ChatMessage[]
  addMessages: (repoPath: string, msgs: ChatMessage[]) => void
  updateMessage: (repoPath: string, id: string, patch: Partial<ChatMessage>) => void
  clearMessages: (repoPath: string) => void
}

let _counter = 0
export function nextMsgId(): string {
  return String(++_counter)
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  messagesByRepo: {},

  getMessages: (repoPath) => get().messagesByRepo[repoPath] ?? [],

  addMessages: (repoPath, msgs) =>
    set((s) => ({
      messagesByRepo: {
        ...s.messagesByRepo,
        [repoPath]: [...(s.messagesByRepo[repoPath] ?? []), ...msgs]
      }
    })),

  updateMessage: (repoPath, id, patch) =>
    set((s) => ({
      messagesByRepo: {
        ...s.messagesByRepo,
        [repoPath]: (s.messagesByRepo[repoPath] ?? []).map((m) =>
          m.id === id ? { ...m, ...patch } : m
        )
      }
    })),

  clearMessages: (repoPath) =>
    set((s) => ({
      messagesByRepo: { ...s.messagesByRepo, [repoPath]: [] }
    }))
}))
