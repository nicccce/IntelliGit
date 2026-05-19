import type { JSX } from 'react'

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
 * 将 chunks 渲染为连续行号的行内 diff 视图。
 * 左侧列 = 旧文件行号（仅 Equal / Delete 递增），
 * 右侧列 = 新文件行号（仅 Equal / Add 递增）。
 */
function DiffChunks({
  chunks
}: {
  chunks: Array<{ content: string; type: 'Add' | 'Delete' | 'Equal' }>
}): JSX.Element {
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
    // 保留末尾空行，但去除最后一个多余的换行符
    const lines = chunk.content.split('\n')
    // 如果末尾是换行符，split 会多一个空字符串，去掉它
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

  return (
    <>
      {rows.map((row, index) => (
        <div
          key={index}
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
      ))}
    </>
  )
}

export default DiffView
