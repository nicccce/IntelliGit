import type { JSX } from 'react'

import { classNames } from '../../utils/classNames'
import { useDiffViewModel } from '../../viewModels'
import styles from './DiffView.module.css'

function DiffView(): JSX.Element {
  const { workdirDiff, stagedDiff, selectedFilePath, diffSource } = useDiffViewModel()

  // 根据 diff 来源决定显示哪个 diff 数据
  const diff = diffSource === 'staged' ? stagedDiff : workdirDiff

  if (!selectedFilePath) return <div className={styles['ig-diff-empty']}>← 选择文件查看差异</div>

  const sourceLabel = diffSource === 'staged' ? '已暂存' : '未暂存'

  // 正在加载 diff 数据
  if (!diff)
    return (
      <div className={styles['ig-diff-empty']}>
        <span className={styles['ig-diff-source-badge']}>{sourceLabel}</span>
        加载差异中...
      </div>
    )

  // 已加载但确实无差异
  if (diff.filePatches.length === 0)
    return (
      <div className={styles['ig-diff-empty']}>
        <span className={styles['ig-diff-source-badge']}>{sourceLabel}</span>
        无差异内容
      </div>
    )

  return (
    <div className={styles['ig-diff-scroll']}>
      {diff.filePatches.map((filePatch, filePatchIndex) => (
        <div key={filePatchIndex}>
          {filePatch.isBinary ? (
            <div className={styles['ig-diff-binary']}>二进制文件</div>
          ) : (
            filePatch.chunks.map((chunk, chunkIndex) => {
              const lines = chunk.content.replace(/\n$/, '').split('\n')
              return (
                <div key={chunkIndex} className={styles['ig-diff-chunk']}>
                  {chunk.type !== 'Equal' && (
                    <div className={styles['ig-diff-hunk-hdr']}>
                      <span>
                        {chunk.type === 'Add' ? '新增' : '删除'} {lines.length} 行
                      </span>
                    </div>
                  )}
                  {lines.map((line, lineIndex) => (
                    <div
                      key={lineIndex}
                      className={classNames(
                        styles['ig-diff-line'],
                        chunk.type === 'Add' && styles.added,
                        chunk.type === 'Delete' && styles.removed
                      )}
                    >
                      <span className={styles['ig-diff-ln']}>{lineIndex + 1}</span>
                      <span className={styles['ig-diff-lc']}>
                        {chunk.type === 'Add' ? '+' : chunk.type === 'Delete' ? '-' : ' '} {line}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })
          )}
        </div>
      ))}
    </div>
  )
}

export default DiffView
