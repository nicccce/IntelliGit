/**
 * 选择状态注册表
 * 用于在 DiffPane（UI 层）与 gitWorkflowService（操作层）之间共享行级选择数据。
 *
 * 当一个文件的操作按钮被点击时，操作层可以从此注册表中读取当前选中的行集合，
 * 从而实现「仅暂存选中的行」的颗粒度控制。
 */

import { buildPatchFromSelection } from '../utils/buildPatchFromSelection'
import type { PatchDetail } from '../../../shared/types'

/**
 * 注册表条目
 */
export interface SelectionEntry {
  /** 选择的行 key 集合 */
  selectedSet: Set<string>
  /** 该文件最新的 diff 数据（用于构造 patch） */
  diff: PatchDetail | null
}

const registry = new Map<string, SelectionEntry>()

/**
 * 生成注册表 key
 */
export function makeKey(source: 'staged' | 'unstaged', filePath: string): string {
  return `${source}::${filePath}`
}

/**
 * 更新某个文件的选择状态
 */
export function updateSelection(
  source: 'staged' | 'unstaged',
  filePath: string,
  selectedSet: Set<string>,
  diff: PatchDetail | null
): void {
  const key = makeKey(source, filePath)
  registry.set(key, { selectedSet, diff })
}

/**
 * 读取某个文件的选中行集合（空 Set 表示无选择）
 */
export function getSelectedSet(source: 'staged' | 'unstaged', filePath: string): Set<string> {
  const entry = registry.get(makeKey(source, filePath))
  return entry ? entry.selectedSet : new Set()
}

/**
 * 判断某个文件是否被全选（所有变更行都被选中）
 * 返回 true 表示全选，false 表示部分选择或无选择
 */
export function isFullySelected(source: 'staged' | 'unstaged', filePath: string): boolean {
  const entry = registry.get(makeKey(source, filePath))
  if (!entry || !entry.diff) return false

  // 统计所有 Add/Delete 行数
  let totalChanged = 0
  for (const fp of entry.diff.filePatches) {
    if (fp.isBinary) continue
    for (const chunk of fp.chunks) {
      if (chunk.type === 'Equal') continue
      const lines = chunk.content.split('\n')
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      totalChanged += lines.length
    }
  }

  return totalChanged > 0 && entry.selectedSet.size === totalChanged
}

/**
 * 根据选择集构建 patch。若已全选则返回 null（表示可退化为常规 addFile/removeFile）
 */
export function buildSelectionPatch(
  source: 'staged' | 'unstaged',
  filePath: string
): string | null {
  const entry = registry.get(makeKey(source, filePath))
  if (!entry || !entry.diff || entry.selectedSet.size === 0) return null

  // 如果全选，返回 null 让调用方退化为全文件操作
  let totalChanged = 0
  for (const fp of entry.diff.filePatches) {
    if (fp.isBinary) continue
    for (const chunk of fp.chunks) {
      if (chunk.type === 'Equal') continue
      const lines = chunk.content.split('\n')
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      totalChanged += lines.length
    }
  }
  if (totalChanged > 0 && entry.selectedSet.size === totalChanged) return null

  return buildPatchFromSelection(entry.diff, entry.selectedSet)
}

/**
 * 清除某个文件的选择状态（暂存操作完成后清理）
 */
export function clearSelection(source: 'staged' | 'unstaged', filePath: string): void {
  registry.delete(makeKey(source, filePath))
}

// ========== 重置信号机制 ==========
// 当 service 层完成暂存/取消暂存操作后，需要通知 UI 层（DiffPane）重置缓存和选择状态
// 信号 key 格式同 makeKey (source::filePath)
const pendingResetSignal = new Set<string>()

/**
 * 压入一个重置信号（由 service 层调用）
 */
export function enqueueReset(key: string): void {
  pendingResetSignal.add(key)
}

/**
 * 消费（取出）指定 key 的重置信号，返回 true 表示存在该信号
 */
export function consumeResetSignal(key: string): boolean {
  if (pendingResetSignal.has(key)) {
    pendingResetSignal.delete(key)
    return true
  }
  return false
}

/**
 * 重置注册表中某个 source+path 对应的条目的 selectedSet 为空
 * 下次 DiffPane 加载此文件时会重新默认全选
 */
export function resetEntry(source: 'staged' | 'unstaged', filePath: string): void {
  const key = makeKey(source, filePath)
  const entry = registry.get(key)
  if (entry) {
    entry.selectedSet = new Set()
  }
}
