/**
 * @file useKeyboardShortcut
 * @description 通用键盘快捷键 Hook，可在任意组件中绑定全局键盘事件。
 */

import { useEffect } from 'react'

/**
 * 绑定全局键盘快捷键
 * @param key - 监听的按键（KeyboardEvent.key）
 * @param callback - 按键触发时的回调
 * @param modifiers - 可选修饰键要求
 */
export function useKeyboardShortcut(
  key: string,
  callback: () => void,
  modifiers?: { ctrl?: boolean; shift?: boolean; alt?: boolean }
): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== key) return
      if (modifiers?.ctrl && !e.ctrlKey && !e.metaKey) return
      if (modifiers?.shift && !e.shiftKey) return
      if (modifiers?.alt && !e.altKey) return

      e.preventDefault()
      callback()
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [key, callback, modifiers])
}
