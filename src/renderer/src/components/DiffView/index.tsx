import { useState, useCallback, type JSX } from 'react'

import { classNames } from '../../utils/classNames'
import { useDiffViewModel } from '../../viewModels'
import styles from './DiffView.module.css'

function DiffView(): JSX.Element {
  const { workdirDiff, stagedDiff, selectedFilePath, diffSource } = useDiffViewModel()

  // 根据 diff 来源决定显示哪个 diff 数据
  const diff = diffSource === 'staged' ? stagedDiff : workdirDiff

  if (!selectedFilePath) return <div className={styles['ig-diff-empty']}>← 选择文件查看差异</div>

  // 正在加载 diff 数据
  if (!diff) return <div className={styles['ig-diff-empty']}>加载中...</div>

  // 已加载但确实无差异
  if (diff.filePatches.length === 0)
    return <div className={styles['ig-diff-empty']}>无差异内容</div>

  return (
    <div className={styles['ig-diff-scroll']}>
      {diff.filePatches.map((filePatch, filePatchIndex) => (
        <div key={filePatchIndex}>
          {filePatch.isBinary ? (
            <div className={styles['ig-diff-binary']}>二进制文件</div>
          ) : (
            <DiffChunks chunks={filePatch.chunks} />
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * 将 chunks 渲染为可折叠的 diff 视图。
 * 折叠规则：
 *  - Equal 块中，头尾各 3 行保留作为上下文，中间部分可折叠
 *  - 折叠是一次性的（展开后不再显示折叠行）
 *  - Add/Delete 始终展开
 * 折叠提示箭头：↓ 块前、↑ 块后、↕ 块中间
 */
function DiffChunks({
  chunks
}: {
  chunks: Array<{ content: string; type: 'Add' | 'Delete' | 'Equal' }>
}): JSX.Element {
  // 存储每个 Equal 块的展开状态，key 为 chunk 索引
  const [expandedSet, setExpanded] = useState<Set<number>>(new Set())

  const expand = useCallback((chunkIndex: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.add(chunkIndex)
      return next
    })
  }, [])

  let oldLineNum = 1
  let newLineNum = 1
  const rows: Array<{
    oldLine: string
    newLine: string
    prefix: string
    text: string
    type: 'Add' | 'Delete' | 'Equal'
  }> = []

  for (const chunk of chunks) {
    const lines = chunk.content.split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop()
    }

    for (const line of lines) {
      const oldStr = chunk.type === 'Add' ? '' : String(oldLineNum)
      const newStr = chunk.type === 'Delete' ? '' : String(newLineNum)
      const prefix = chunk.type === 'Add' ? '+' : chunk.type === 'Delete' ? '-' : ' '

      rows.push({
        oldLine: oldStr,
        newLine: newStr,
        prefix,
        text: line,
        type: chunk.type
      })

      if (chunk.type !== 'Add') oldLineNum++
      if (chunk.type !== 'Delete') newLineNum++
    }
  }

  const CONTEXT_LINES = 3

  // 判断 Equal 块前后是否有变更块
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

  // 判断 Equal 块前后的变更情况，确定折叠箭头方向
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
    return 'both' // 前后都没有变更，用 ↕
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

      // 仅当实际邻近变更块时才保留对应侧的上下文行
      const headLines = prevChange ? Math.min(CONTEXT_LINES, lineCount) : 0
      const tailLines = nextChange ? Math.min(CONTEXT_LINES, lineCount) : 0
      const foldMiddle = Math.max(0, lineCount - headLines - tailLines)
      const showFold = foldMiddle > 0
      const expanded = expandedSet.has(ci)

      // 前部上下文（仅当前面有变更块时）
      for (let i = 0; i < headLines; i++) {
        const row = rows[rowIndex]
        chunksOutput.push(
          <div
            key={`r-${ci}-head-${i}`}
            className={classNames(styles['ig-diff-line'], styles['ig-diff-context'])}
          >
            <span className={styles['ig-diff-ln-old']}>{row.oldLine}</span>
            <span className={styles['ig-diff-ln-new']}>{row.newLine}</span>
            <span className={styles['ig-diff-prefix']}>{row.prefix}</span>
            <span className={styles['ig-diff-lc']}>{row.text}</span>
          </div>
        )
        rowIndex++
      }

      // 中间折叠/展开部分
      if (showFold && !expanded) {
        const dir = getArrowDirection(ci)
        chunksOutput.push(
          <div
            key={`fold-${ci}`}
            className={styles['ig-diff-fold-line']}
            onClick={() => expand(ci)}
          >
            <span className={classNames(styles['ig-diff-ln-old'], styles['ig-diff-folding'])} />
            <span className={classNames(styles['ig-diff-ln-new'], styles['ig-diff-folding'])} />
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
              <span className={styles['ig-diff-ln-old']}>{row.oldLine}</span>
              <span className={styles['ig-diff-ln-new']}>{row.newLine}</span>
              <span className={styles['ig-diff-prefix']}>{row.prefix}</span>
              <span className={styles['ig-diff-lc']}>{row.text}</span>
            </div>
          )
          rowIndex++
        }
      } else {
        // 行数不够折叠，全部直接渲染
        for (let i = 0; i < foldMiddle; i++) {
          const row = rows[rowIndex]
          chunksOutput.push(
            <div
              key={`r-${ci}-mid-${i}`}
              className={classNames(styles['ig-diff-line'], styles['ig-diff-context'])}
            >
              <span className={styles['ig-diff-ln-old']}>{row.oldLine}</span>
              <span className={styles['ig-diff-ln-new']}>{row.newLine}</span>
              <span className={styles['ig-diff-prefix']}>{row.prefix}</span>
              <span className={styles['ig-diff-lc']}>{row.text}</span>
            </div>
          )
          rowIndex++
        }
      }

      // 尾部上下文（仅当后面有变更块时）
      for (let i = 0; i < tailLines; i++) {
        const row = rows[rowIndex]
        chunksOutput.push(
          <div
            key={`r-${ci}-tail-${i}`}
            className={classNames(styles['ig-diff-line'], styles['ig-diff-context'])}
          >
            <span className={styles['ig-diff-ln-old']}>{row.oldLine}</span>
            <span className={styles['ig-diff-ln-new']}>{row.newLine}</span>
            <span className={styles['ig-diff-prefix']}>{row.prefix}</span>
            <span className={styles['ig-diff-lc']}>{row.text}</span>
          </div>
        )
        rowIndex++
      }
    } else {
      // Add / Delete 始终展开
      for (let i = 0; i < lineCount; i++) {
        const row = rows[rowIndex]
        chunksOutput.push(
          <div
            key={`r-${ci}-${i}`}
            className={classNames(
              styles['ig-diff-line'],
              row.type === 'Add' && styles.added,
              row.type === 'Delete' && styles.removed
            )}
          >
            <span className={styles['ig-diff-ln-old']}>{row.oldLine}</span>
            <span className={styles['ig-diff-ln-new']}>{row.newLine}</span>
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
