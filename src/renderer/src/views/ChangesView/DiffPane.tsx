import type { JSX } from 'react'
import { useMemo } from 'react'

import type { PatchDetail } from '../../../../shared/types'
import type { DiffSource } from '../../store/diffStore'
import { useDiffViewModel } from '../../viewModels'
import DiffView from '../../components/DiffView'
import styles from './DiffPane.module.css'

interface DiffPaneProps {
  selectedFilePath: string | null
  diffSource: DiffSource | null
}

/** 计算 diff 中的总新增行数和总删除行数 */
function countDiffStats(diff: PatchDetail | null): { additions: number; deletions: number } {
  if (!diff) return { additions: 0, deletions: 0 }
  let additions = 0
  let deletions = 0
  for (const filePatch of diff.filePatches) {
    if (filePatch.isBinary) continue
    for (const chunk of filePatch.chunks) {
      // 更健壮的行数计算：处理末尾有/无换行符的情况
      const lines = chunk.content.split('\n')
      let lineCount = lines.length
      // 如果末尾有换行符，split 会产生一个空字符串，需要扣除
      if (lines[lines.length - 1] === '') {
        lineCount--
      }
      // 如果 content 为空字符串，行数为 0
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

function DiffPane({ selectedFilePath, diffSource }: DiffPaneProps): JSX.Element {
  const { workdirDiff, stagedDiff } = useDiffViewModel()

  const diff = diffSource === 'staged' ? stagedDiff : workdirDiff
  const { additions, deletions } = useMemo(() => countDiffStats(diff), [diff])

  const sourceLabel = diffSource === 'staged' ? '（已暂存）' : '（未暂存）'
  return (
    <div className={styles['ig-diff-view']}>
      <div className={styles['ig-diff-header']}>
        <div className={styles['ig-diff-header-left']}>
          <span className={styles['ig-diff-title']}>
            {selectedFilePath ? `${selectedFilePath} ${sourceLabel}` : '选择文件查看差异'}
          </span>
        </div>
        {selectedFilePath && diff && (
          <div className={styles['ig-diff-stats']}>
            <span className={styles['ig-diff-stat-add']}>+{additions}</span>
            <span className={styles['ig-diff-stat-del']}>-{deletions}</span>
          </div>
        )}
      </div>
      <DiffView />
    </div>
  )
}

export default DiffPane
