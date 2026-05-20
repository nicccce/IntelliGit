import type { JSX } from 'react'
import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { Checkbox } from 'antd'

import type { PatchDetail } from '../../../../shared/types'
import type { DiffSource } from '../../store/diffStore'
import { useDiffViewModel } from '../../viewModels'
import DiffView from '../../components/DiffView'
import styles from './DiffPane.module.css'
import type { FileSelectionState } from './FileSection'

interface DiffPaneProps {
  selectedFilePath: string | null
  diffSource: DiffSource | null
  /** 选择状态变化回调 */
  onSelectionChange?: (source: DiffSource, filePath: string, state: FileSelectionState) => void
}

/** 计算 diff 中的总新增行数和总删除行数 */
function countDiffStats(diff: PatchDetail | null): { additions: number; deletions: number } {
  if (!diff) return { additions: 0, deletions: 0 }
  let additions = 0
  let deletions = 0
  for (const filePatch of diff.filePatches) {
    if (filePatch.isBinary) continue
    for (const chunk of filePatch.chunks) {
      const lines = chunk.content.split('\n')
      let lineCount = lines.length
      if (lines[lines.length - 1] === '') {
        lineCount--
      }
      if (chunk.content === '') {
        lineCount = 0
      }
      if (chunk.type === 'Add') {
        additions += lineCount
      } else if (chunk.type === 'Delete') {
        deletions += lineCount
      }
    }
  }
  return { additions, deletions }
}

/** 生成行级唯一 key */
function lineKey(filePatchIndex: number, chunkIndex: number, lineIndex: number): string {
  return `${filePatchIndex}-${chunkIndex}-${lineIndex}`
}

/** 从 diff 中收集所有 Add/Delete 行的 key */
function collectChangedLineKeys(diff: PatchDetail | null): Set<string> {
  const keys = new Set<string>()
  if (!diff) return keys
  for (let fi = 0; fi < diff.filePatches.length; fi++) {
    const fp = diff.filePatches[fi]
    if (fp.isBinary) continue
    for (let ci = 0; ci < fp.chunks.length; ci++) {
      const chunk = fp.chunks[ci]
      if (chunk.type === 'Equal') continue
      const lines = chunk.content.split('\n')
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      for (let li = 0; li < lines.length; li++) {
        keys.add(lineKey(fi, ci, li))
      }
    }
  }
  return keys
}

function DiffPane({ selectedFilePath, diffSource, onSelectionChange }: DiffPaneProps): JSX.Element {
  const { workdirDiff, stagedDiff } = useDiffViewModel()

  const diff = diffSource === 'staged' ? stagedDiff : workdirDiff
  const { additions, deletions } = useMemo(() => countDiffStats(diff), [diff])

  // ---------- 选择状态（缓存各文件的不同状态） ----------
  // 缓存条目：{ set: 选中行的 key 集合, initialized: 是否已完成初始默认全选 }
  const cacheRef = useRef<Map<string, { set: Set<string>; initialized: boolean }>>(new Map())
  const resetKey = diffSource && selectedFilePath ? `${diffSource}::${selectedFilePath}` : null

  const initCache = (key: string | null): { set: Set<string>; initialized: boolean } => {
    if (!key) return { set: new Set(), initialized: false }
    const existing = cacheRef.current.get(key)
    if (existing) return existing
    const entry = { set: new Set<string>(), initialized: false }
    cacheRef.current.set(key, entry)
    return entry
  }

  // 从缓存中获取当前文件的选择状态
  const [selectedSet, setSelectedSet] = useState<Set<string>>(() => {
    return new Set(initCache(resetKey).set)
  })

  // 当 resetKey 变化时从缓存恢复
  const [prevResetKey, setPrevResetKey] = useState<string | null>(null)
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey)
    setSelectedSet(new Set(initCache(resetKey).set))
  }

  const allChangedKeys = useMemo(() => collectChangedLineKeys(diff), [diff])

  // 当 diff 加载完成后，若当前文件未初始化且选择集为空，则默认全选
  useEffect(() => {
    if (!resetKey || allChangedKeys.size === 0) return
    const entry = cacheRef.current.get(resetKey)
    if (!entry || entry.initialized) return
    if (selectedSet.size !== 0) return

    // 首次加载此文件，默认全选
    const fullSet = new Set(allChangedKeys)
    entry.set = fullSet
    entry.initialized = true
    setSelectedSet(fullSet)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, allChangedKeys.size])

  // 当 allChangedKeys 变化时，清理 selectedSet 中已不存在的脏 key，若全部无效则重新全选
  useEffect(() => {
    if (!resetKey || allChangedKeys.size === 0) return

    let changed = false
    const cleaned = new Set(selectedSet)
    for (const key of cleaned) {
      if (!allChangedKeys.has(key)) {
        cleaned.delete(key)
        changed = true
      }
    }

    if (changed) {
      // 有无效 key 被清理
      if (cleaned.size === 0) {
        // 全部被清空 → 重新全选
        const fullSet = new Set(allChangedKeys)
        setSelectedSet(fullSet)
        const entry = cacheRef.current.get(resetKey)
        if (entry) {
          entry.set = fullSet
          entry.initialized = true
        }
      } else {
        setSelectedSet(cleaned)
        const entry = cacheRef.current.get(resetKey)
        if (entry) entry.set = cleaned
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, allChangedKeys])

  // 当 selectedSet 变化时更新缓存，并通知父组件选择状态
  useEffect(() => {
    if (!resetKey) return
    const entry = cacheRef.current.get(resetKey)
    if (entry) {
      entry.set = new Set(selectedSet)
    }
    if (onSelectionChange && diffSource && selectedFilePath) {
      const state: FileSelectionState =
        selectedSet.size === 0
          ? 'none'
          : selectedSet.size === allChangedKeys.size
            ? 'all'
            : 'partial'
      onSelectionChange(diffSource, selectedFilePath, state)
    }
  }, [resetKey, selectedSet, allChangedKeys.size, onSelectionChange, diffSource, selectedFilePath])

  const isAllSelected = useMemo(
    () => allChangedKeys.size > 0 && allChangedKeys.size === selectedSet.size,
    [allChangedKeys, selectedSet]
  )
  const isPartiallySelected = useMemo(
    () => selectedSet.size > 0 && !isAllSelected,
    [selectedSet, isAllSelected]
  )

  const onToggleLine = useCallback((key: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const onToggleChunk = useCallback(
    (filePatchIndex: number, chunkIndex: number) => {
      const chunk = diff?.filePatches[filePatchIndex]?.chunks[chunkIndex]
      if (!chunk || chunk.type === 'Equal') return
      const lines = chunk.content.split('\n')
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      const keys: string[] = []
      for (let li = 0; li < lines.length; li++) {
        keys.push(lineKey(filePatchIndex, chunkIndex, li))
      }
      setSelectedSet((prev) => {
        const next = new Set(prev)
        const allSelected = keys.every((k) => next.has(k))
        if (allSelected) {
          keys.forEach((k) => next.delete(k))
        } else {
          keys.forEach((k) => next.add(k))
        }
        return next
      })
    },
    [diff]
  )

  const onToggleAll = useCallback(() => {
    setSelectedSet((prev) => {
      if (prev.size === allChangedKeys.size && allChangedKeys.size > 0) {
        return new Set()
      } else {
        return new Set(allChangedKeys)
      }
    })
  }, [allChangedKeys])

  const sourceLabel = diffSource === 'staged' ? '（已暂存）' : '（未暂存）'

  const checkAllDisabled = allChangedKeys.size === 0

  return (
    <div className={styles['ig-diff-view']}>
      <div className={styles['ig-diff-header']}>
        <div className={styles['ig-diff-header-left']}>
          {selectedFilePath && diff ? (
            <>
              <Checkbox
                indeterminate={isPartiallySelected}
                checked={isAllSelected}
                disabled={checkAllDisabled}
                onChange={() => onToggleAll()}
                className={styles['ig-diff-check-all']}
              />
              <span className={styles['ig-diff-title']}>
                {selectedFilePath}
                {sourceLabel}
              </span>
            </>
          ) : (
            <span className={styles['ig-diff-title']}>选择文件查看差异</span>
          )}
        </div>
        <div className={styles['ig-diff-header-right']}>
          {selectedFilePath && diff && (
            <div className={styles['ig-diff-stats']}>
              <span className={styles['ig-diff-stat-add']}>+{additions}</span>
              <span className={styles['ig-diff-stat-del']}>-{deletions}</span>
            </div>
          )}
        </div>
      </div>
      <DiffView
        selectedSet={selectedSet}
        onToggleLine={onToggleLine}
        onToggleChunk={onToggleChunk}
      />
    </div>
  )
}

export default DiffPane
