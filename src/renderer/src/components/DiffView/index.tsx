import { useState, useCallback, useMemo, useEffect, type JSX } from 'react'

import { classNames } from '../../utils/classNames'
import { useDiffViewModel } from '../../viewModels'
import { analyzeAstChanges, type AstChangeInsight } from '../../utils/astChangeAnalyzer'
import type { ChunkInfo } from '../../../../shared/types'
import styles from './DiffView.module.css'

/** 生成行级唯一 key */
function lineKey(filePatchIndex: number, chunkIndex: number, lineIndex: number): string {
  return `${filePatchIndex}-${chunkIndex}-${lineIndex}`
}

interface HunkOwnerInsight {
  ownerLabel?: string
  oldOwner?: { startLine: number; endLine: number }
  newOwner?: { startLine: number; endLine: number }
  confidence?: 'high' | 'medium' | 'low'
}

interface AggregatedDiffSummary {
  confidence?: 'high' | 'medium' | 'low'
  summary: string
  changeKinds: string[]
}

function hunkLabel(insight: HunkOwnerInsight | undefined): string | undefined {
  if (!insight?.ownerLabel) return undefined
  const oldText = insight.oldOwner ? `old ${insight.oldOwner.startLine}-${insight.oldOwner.endLine}` : 'old -'
  const newText = insight.newOwner ? `new ${insight.newOwner.startLine}-${insight.newOwner.endLine}` : 'new -'
  return `${insight.ownerLabel} · ${oldText} · ${newText}`
}

interface DiffViewProps {
  selectedSet: Set<string>
  onToggleLine: (key: string) => void
  /** 切换整个 chunk 的选择状态 */
  onToggleChunk: (filePatchIndex: number, chunkIndex: number) => void
}

function DiffView({ selectedSet, onToggleLine, onToggleChunk }: DiffViewProps): JSX.Element {
  const { workdirDiff, stagedDiff, selectedFilePath, diffSource, fetchRawDiff } = useDiffViewModel()

  const diff = diffSource === 'staged' ? stagedDiff : workdirDiff
  const [aggregatedSummary, setAggregatedSummary] = useState<AggregatedDiffSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadSummary() {
      if (!selectedFilePath) {
        setAggregatedSummary(null)
        return
      }
      const rawDiff = await fetchRawDiff(selectedFilePath)
      if (cancelled || !rawDiff.trim()) {
        setAggregatedSummary(null)
        return
      }
      const insights = analyzeAstChanges([selectedFilePath], rawDiff)
      const summary = insights[0]
      if (!summary) {
        setAggregatedSummary(null)
        return
      }
      setAggregatedSummary({
        confidence: summary.confidence,
        summary: summary.summary,
        changeKinds: summary.changeKinds
      })
    }
    void loadSummary()
    return () => {
      cancelled = true
    }
  }, [fetchRawDiff, selectedFilePath])

  if (!selectedFilePath) return <div className={styles['ig-diff-empty']}>← 选择文件查看差异</div>

  if (!diff) return <div className={styles['ig-diff-empty']}>加载中...</div>

  // 修改后文件内容无差异
  if (diff.filePatches.length === 0)
    return <div className={styles['ig-diff-empty']}>无差异内容</div>

  // 新增空文件
  const isEmptyNewFile =
    diff.filePatches.length > 0 &&
    diff.filePatches.every((fp) => !fp.isBinary && fp.chunks.length === 0)
  if (isEmptyNewFile) return <div className={styles['ig-diff-empty']}>新增文件为空</div>

  return (
    <div className={styles['ig-diff-scroll']}>
      {aggregatedSummary && (
        <div className={styles['ig-diff-aggregate-card']}>
          <div className={styles['ig-diff-aggregate-head']}>
            <span className={styles['ig-diff-hunk-owner-label']}>聚合摘要</span>
            <span className={styles['ig-diff-aggregate-summary']}>{aggregatedSummary.summary}</span>
          </div>
          <div className={styles['ig-diff-aggregate-tags']}>
            <span
              className={classNames(
                styles['ig-diff-aggregate-tag'],
                aggregatedSummary.confidence === 'high' && styles['ig-diff-aggregate-tag-high'],
                aggregatedSummary.confidence === 'medium' && styles['ig-diff-aggregate-tag-medium'],
                aggregatedSummary.confidence === 'low' && styles['ig-diff-aggregate-tag-low']
              )}
            >
              {`置信度 ${aggregatedSummary.confidence || 'low'}`}
            </span>
            {aggregatedSummary.changeKinds.slice(0, 4).map((kind) => (
              <span key={kind} className={styles['ig-diff-aggregate-tag']}>
                {kind}
              </span>
            ))}
          </div>
        </div>
      )}
      {diff.filePatches.map((filePatch, filePatchIndex) => (
        <div key={filePatchIndex}>
          {filePatch.isBinary ? (
            <div className={styles['ig-diff-binary']}>二进制文件</div>
          ) : (
            <DiffChunks
              filePatchIndex={filePatchIndex}
              chunks={filePatch.chunks}
              selectedSet={selectedSet}
              onToggleLine={onToggleLine}
              onToggleChunk={onToggleChunk}
            />
          )}
        </div>
      ))}
    </div>
  )
}

interface DiffChunksProps {
  filePatchIndex: number
  chunks: ChunkInfo[]
  selectedSet: Set<string>
  onToggleLine: (key: string) => void
  onToggleChunk: (filePatchIndex: number, chunkIndex: number) => void
}

/**
 * 将 chunks 渲染为可折叠的 diff 视图，每行左侧增加两列选择按钮。
 */
function DiffChunks({
  filePatchIndex,
  chunks,
  selectedSet,
  onToggleLine,
  onToggleChunk
}: DiffChunksProps): JSX.Element {
  // 存储每个 Equal 块的展开状态，key 为 chunk 索引
  const [expandedSet, setExpanded] = useState<Set<number>>(new Set())
  // 当前 hover 的 chunk 索引（用于块按钮悬停时联动高亮该块的行按钮）
  const [hoveredChunkIndex, setHoveredChunkIndex] = useState<number | null>(null)

  const expand = useCallback((chunkIndex: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.add(chunkIndex)
      return next
    })
  }, [])

  // 预先计算每行的 lineKey 列表，用于块级选择
  const chunkLineKeys: Array<{ chunkIndex: number; keys: string[] }> = useMemo(() => {
    const result: Array<{ chunkIndex: number; keys: string[] }> = []
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci]
      const lines = chunk.content.split('\n')
      // 去除末尾空行
      if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop()
      }
      const keys: string[] = []
      for (let li = 0; li < lines.length; li++) {
        keys.push(lineKey(filePatchIndex, ci, li))
      }
      result.push({ chunkIndex: ci, keys })
    }
    return result
  }, [chunks, filePatchIndex])

  // 判断某个 chunk 的选择状态：'none' | 'partial' | 'all'
  const getChunkSelectionState = useCallback(
    (chunkIndex: number): 'none' | 'partial' | 'all' => {
      const info = chunkLineKeys[chunkIndex]
      if (!info) return 'none'
      const chunk = chunks[chunkIndex]
      if (chunk.type === 'Equal') return 'none'
      const lines = chunk.content.split('\n')
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      let changedCount = 0
      let selectedCount = 0
      for (let li = 0; li < lines.length; li++) {
        changedCount++
        if (selectedSet.has(info.keys[li])) selectedCount++
      }
      if (selectedCount === 0) return 'none'
      if (selectedCount === changedCount) return 'all'
      return 'partial'
    },
    [chunkLineKeys, chunks, selectedSet]
  )

  const handleChunkToggle = useCallback(
    (chunkIndex: number) => {
      onToggleChunk(filePatchIndex, chunkIndex)
    },
    [filePatchIndex, onToggleChunk]
  )

  const chunkHunkInsights = useMemo(() => new Map<number, HunkOwnerInsight>(), [])

  let oldLineNum = 1
  let newLineNum = 1
  const rows: Array<{
    oldLine: string
    newLine: string
    prefix: string
    text: string
    type: 'Add' | 'Delete' | 'Equal'
    chunkIndex: number
    lineIndex: number
  }> = []

  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]
    const lines = chunk.content.split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop()
    }

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]
      const oldStr = chunk.type === 'Add' ? '' : String(oldLineNum)
      const newStr = chunk.type === 'Delete' ? '' : String(newLineNum)
      const prefix = chunk.type === 'Add' ? '+' : chunk.type === 'Delete' ? '-' : ' '

      rows.push({
        oldLine: oldStr,
        newLine: newStr,
        prefix,
        text: line,
        type: chunk.type,
        chunkIndex: ci,
        lineIndex: li
      })

      if (chunk.type !== 'Add') oldLineNum++
      if (chunk.type !== 'Delete') newLineNum++
    }
  }

  const CONTEXT_LINES = 3

  function hasPrevChangeBlock(chunkIndex: number): boolean {
    for (let i = chunkIndex - 1; i >= 0; i--) {
      if (chunks[i].type !== 'Equal') return true
    }
    return false
  }
  function hasNextChangeBlock(chunkIndex: number): boolean {
    for (let i = chunkIndex + 1; i < chunks.length; i++) {
      if (chunks[i].type !== 'Equal') return true
    }
    return false
  }

  function getArrowDirection(chunkIndex: number): 'down' | 'up' | 'both' {
    let hasPrevChange = false
    let hasNextChange = false

    for (let i = chunkIndex - 1; i >= 0; i--) {
      if (chunks[i].type !== 'Equal') {
        hasPrevChange = true
        break
      }
    }
    for (let i = chunkIndex + 1; i < chunks.length; i++) {
      if (chunks[i].type !== 'Equal') {
        hasNextChange = true
        break
      }
    }

    if (hasPrevChange && hasNextChange) return 'both'
    if (hasPrevChange) return 'down'
    if (hasNextChange) return 'up'
    return 'both'
  }

  const arrowLabel: Record<string, string> = {
    down: '\u2193',
    up: '\u2191',
    both: '\u2195'
  }

  // 按 chunk 组装输出
  const chunksOutput: JSX.Element[] = []
  let rowIndex = 0
  for (let ci = 0; ci < chunks.length; ci++) {
    const chunk = chunks[ci]
    const lines = chunk.content.split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop()
    }
    const lineCount = lines.length

    if (chunk.type === 'Equal') {
      const prevChange = hasPrevChangeBlock(ci)
      const nextChange = hasNextChangeBlock(ci)

      const headLines = prevChange ? Math.min(CONTEXT_LINES, lineCount) : 0
      const tailLines = nextChange ? Math.min(CONTEXT_LINES, lineCount - headLines) : 0
      const foldMiddle = Math.max(0, lineCount - headLines - tailLines)
      const showFold = foldMiddle > 0
      const expanded = expandedSet.has(ci)

      for (let i = 0; i < headLines; i++) {
        const row = rows[rowIndex]
        chunksOutput.push(
          <div
            key={`r-${ci}-head-${i}`}
            className={classNames(styles['ig-diff-line'], styles['ig-diff-context'])}
          >
            <span
              className={classNames(styles['ig-diff-chk-block'], styles['ig-diff-chk-disabled'])}
            />
            <span
              className={classNames(
                styles['ig-diff-chk-line-group'],
                styles['ig-diff-chk-disabled']
              )}
            >
              <span
                className={classNames(styles['ig-diff-chk-line'], styles['ig-diff-chk-disabled'])}
              />
              <span
                className={classNames(styles['ig-diff-ln-old'], styles['ig-diff-chk-disabled'])}
              >
                {row.oldLine}
              </span>
              <span
                className={classNames(styles['ig-diff-ln-new'], styles['ig-diff-chk-disabled'])}
              >
                {row.newLine}
              </span>
            </span>
            <span className={styles['ig-diff-prefix']}>{row.prefix}</span>
            <span className={styles['ig-diff-lc']}>{row.text}</span>
          </div>
        )
        rowIndex++
      }

      if (showFold && !expanded) {
        const dir = getArrowDirection(ci)
        chunksOutput.push(
          <div
            key={`fold-${ci}`}
            className={styles['ig-diff-fold-line']}
            onClick={() => expand(ci)}
          >
            <span
              className={classNames(styles['ig-diff-chk-block'], styles['ig-diff-chk-disabled'])}
            />
            <span
              className={classNames(
                styles['ig-diff-chk-line-group'],
                styles['ig-diff-chk-disabled']
              )}
            >
              <span
                className={classNames(styles['ig-diff-chk-line'], styles['ig-diff-chk-disabled'])}
              />
              <span
                className={classNames(
                  styles['ig-diff-ln-old'],
                  styles['ig-diff-folding'],
                  styles['ig-diff-chk-disabled']
                )}
              />
              <span
                className={classNames(
                  styles['ig-diff-ln-new'],
                  styles['ig-diff-folding'],
                  styles['ig-diff-chk-disabled']
                )}
              />
            </span>
            <span className={classNames(styles['ig-diff-prefix'], styles['ig-diff-folding'])} />
            <span className={styles['ig-diff-fold-text']}>
              {arrowLabel[dir]} 展开 {foldMiddle} 行
            </span>
          </div>
        )
        rowIndex += foldMiddle
      } else if (showFold && expanded) {
        for (let i = 0; i < foldMiddle; i++) {
          const row = rows[rowIndex]
          chunksOutput.push(
            <div
              key={`r-${ci}-mid-${i}`}
              className={classNames(styles['ig-diff-line'], styles['ig-diff-context'])}
            >
              <span
                className={classNames(styles['ig-diff-chk-block'], styles['ig-diff-chk-disabled'])}
              />
              <span
                className={classNames(
                  styles['ig-diff-chk-line-group'],
                  styles['ig-diff-chk-disabled']
                )}
              >
                <span
                  className={classNames(styles['ig-diff-chk-line'], styles['ig-diff-chk-disabled'])}
                />
                <span
                  className={classNames(styles['ig-diff-ln-old'], styles['ig-diff-chk-disabled'])}
                >
                  {row.oldLine}
                </span>
                <span
                  className={classNames(styles['ig-diff-ln-new'], styles['ig-diff-chk-disabled'])}
                >
                  {row.newLine}
                </span>
              </span>
              <span className={styles['ig-diff-prefix']}>{row.prefix}</span>
              <span className={styles['ig-diff-lc']}>{row.text}</span>
            </div>
          )
          rowIndex++
        }
      } else {
        for (let i = 0; i < foldMiddle; i++) {
          const row = rows[rowIndex]
          chunksOutput.push(
            <div
              key={`r-${ci}-mid-${i}`}
              className={classNames(styles['ig-diff-line'], styles['ig-diff-context'])}
            >
              <span
                className={classNames(styles['ig-diff-chk-block'], styles['ig-diff-chk-disabled'])}
              />
              <span
                className={classNames(
                  styles['ig-diff-chk-line-group'],
                  styles['ig-diff-chk-disabled']
                )}
              >
                <span
                  className={classNames(styles['ig-diff-chk-line'], styles['ig-diff-chk-disabled'])}
                />
                <span
                  className={classNames(styles['ig-diff-ln-old'], styles['ig-diff-chk-disabled'])}
                >
                  {row.oldLine}
                </span>
                <span
                  className={classNames(styles['ig-diff-ln-new'], styles['ig-diff-chk-disabled'])}
                >
                  {row.newLine}
                </span>
              </span>
              <span className={styles['ig-diff-prefix']}>{row.prefix}</span>
              <span className={styles['ig-diff-lc']}>{row.text}</span>
            </div>
          )
          rowIndex++
        }
      }

      for (let i = 0; i < tailLines; i++) {
        const row = rows[rowIndex]
        chunksOutput.push(
          <div
            key={`r-${ci}-tail-${i}`}
            className={classNames(styles['ig-diff-line'], styles['ig-diff-context'])}
          >
            <span
              className={classNames(styles['ig-diff-chk-block'], styles['ig-diff-chk-disabled'])}
            />
            <span
              className={classNames(
                styles['ig-diff-chk-line-group'],
                styles['ig-diff-chk-disabled']
              )}
            >
              <span
                className={classNames(styles['ig-diff-chk-line'], styles['ig-diff-chk-disabled'])}
              />
              <span
                className={classNames(styles['ig-diff-ln-old'], styles['ig-diff-chk-disabled'])}
              >
                {row.oldLine}
              </span>
              <span
                className={classNames(styles['ig-diff-ln-new'], styles['ig-diff-chk-disabled'])}
              >
                {row.newLine}
              </span>
            </span>
            <span className={styles['ig-diff-prefix']}>{row.prefix}</span>
            <span className={styles['ig-diff-lc']}>{row.text}</span>
          </div>
        )
        rowIndex++
      }
    } else {
      // Add / Delete 始终展开
      const blockHovered = hoveredChunkIndex === ci
      const selState = getChunkSelectionState(ci)
      const ownerText = hunkLabel(chunkHunkInsights.get(ci))
      if (ownerText) {
        chunksOutput.push(
          <div key={`owner-${ci}`} className={styles['ig-diff-hunk-owner']}>
            <span className={styles['ig-diff-hunk-owner-label']}>所属符号</span>
            <span>{ownerText}</span>
          </div>
        )
      }
      for (let i = 0; i < lineCount; i++) {
        const row = rows[rowIndex]
        const key = lineKey(filePatchIndex, row.chunkIndex, row.lineIndex)
        const isSel = selectedSet.has(key)
        chunksOutput.push(
          <div
            key={`r-${ci}-${i}`}
            className={classNames(
              styles['ig-diff-line'],
              row.type === 'Add' && styles.added,
              row.type === 'Delete' && styles.removed
            )}
          >
            {/* 块选择列 — 无文字，仅通过颜色指示状态 */}
            <span
              className={classNames(
                styles['ig-diff-chk-block'],
                selState === 'all' && styles['ig-diff-chk-block-all'],
                selState === 'partial' && styles['ig-diff-chk-block-partial'],
                blockHovered && styles['ig-diff-chk-block-hovered']
              )}
              onClick={(e) => {
                e.stopPropagation()
                handleChunkToggle(ci)
              }}
              onMouseEnter={() => setHoveredChunkIndex(ci)}
              onMouseLeave={() => setHoveredChunkIndex(null)}
            />
            {/* 行选择联合容器（✓ 标记 + 两列行号） */}
            <span
              className={classNames(
                styles['ig-diff-chk-line-group'],
                blockHovered && styles['ig-diff-chk-line-group-hovered'],
                isSel && styles['ig-diff-chk-line-group-checked']
              )}
              onClick={(e) => {
                e.stopPropagation()
                onToggleLine(key)
              }}
            >
              <span
                className={classNames(
                  styles['ig-diff-chk-line'],
                  isSel && styles['ig-diff-chk-line-checked']
                )}
              >
                {isSel ? '✓' : ''}
              </span>
              <span className={classNames(styles['ig-diff-ln-old'], styles['ig-diff-chk-ln'])}>
                {row.oldLine}
              </span>
              <span className={classNames(styles['ig-diff-ln-new'], styles['ig-diff-chk-ln'])}>
                {row.newLine}
              </span>
            </span>
            <span className={styles['ig-diff-prefix']}>{row.prefix}</span>
            <span className={styles['ig-diff-lc']}>{row.text}</span>
          </div>
        )
        rowIndex++
      }
    }
  }

  return <>{chunksOutput}</>
}

export default DiffView
