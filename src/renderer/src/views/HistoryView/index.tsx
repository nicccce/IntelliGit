import type { JSX } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { Empty } from 'antd'

import { useResizable } from '../../hooks'
import { useHistoryViewModel } from '../../viewModels'
import { useShadowMergeStore } from '../../store/shadowMergeStore'
import BranchPanel from './BranchPanel'
import CommitDetail from './CommitDetail'
import CommitGraph from './CommitGraph'
import styles from './HistoryView.module.css'

function HistoryView(): JSX.Element {
  const {
    allCommitHistory,
    allBranches,
    currentBranch,
    currentRepo,
    selectedCommit,
    selectedCommitFiles,
    selectCommit,
    fetchAllHistory,
    laneMap,
    isBusy
  } = useHistoryViewModel()

  const checkAllBranches = useShadowMergeStore((s) => s.checkAllBranches)
  const clearResults = useShadowMergeStore((s) => s.clearResults)

  useEffect(() => {
    if (currentRepo) fetchAllHistory()
  }, [currentRepo, fetchAllHistory])

  // 切换仓库时清空上一次的预检缓存
  useEffect(() => {
    if (!currentRepo) clearResults()
  }, [currentRepo, clearResults])

  // 分支列表就绪后，在后台逐一执行影子合并预检
  useEffect(() => {
    if (!currentRepo || allBranches.length === 0) return
    const localBranches = allBranches
      .filter((b) => !b.isRemote && !b.isHead)
      .map((b) => b.name)
    if (localBranches.length === 0) return
    // 非阻塞：结果逐个写入 store，UI 会随之更新
    checkAllBranches(localBranches).catch((err) =>
      console.warn('[HistoryView] 影子合并预检失败:', err)
    )
  }, [currentRepo, allBranches, checkAllBranches])

  useEffect(() => {
    if (!currentRepo || allCommitHistory.length === 0) return
    // 仅在没有选中项时自动选中 HEAD commit，不覆盖用户的主动选择
    if (selectedCommit) return

    const headCommit = allCommitHistory.find(
      (commit) => commit.refs && commit.refs.includes(currentBranch)
    )
    if (headCommit) selectCommit(headCommit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCommitHistory, currentBranch, currentRepo])

  // Hooks 必须在所有 return 之前调用
  const handleSelectBranch = useCallback(
    (branchName: string) => {
      const match = allCommitHistory.find(
        (c) => c.refs && c.refs.some((r) => r === branchName)
      )
      if (match) selectCommit(match)
    },
    [allCommitHistory, selectCommit]
  )

  const graphDetailRef = useRef<HTMLDivElement>(null)
  const {
    ratio: graphRatio,
    handleMouseDown: onGraphResize,
    isDragging: isGraphResizing
  } = useResizable({
    direction: 'horizontal',
    defaultRatio: 0.65,
    minRatio: 0.3,
    maxRatio: 0.8,
    containerRef: graphDetailRef
  })

  if (!currentRepo) {
    return (
      <div className={styles['ig-empty-view']}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择仓库查看历史" />
      </div>
    )
  }

  return (
    <div className={styles['ig-history-view']} id="history-view">
      <BranchPanel
        branches={allBranches}
        currentBranch={currentBranch}
        onSelectBranch={handleSelectBranch}
      />
      <div
        ref={graphDetailRef}
        className={`${styles['ig-graph-detail-area']} ${isGraphResizing ? styles['ig-resizing-h'] : ''}`}
      >
        <div className={styles['ig-graph-panel']} style={{ width: `${graphRatio * 100}%` }}>
          <CommitGraph
            commits={allCommitHistory}
            laneMap={laneMap}
            selectedCommitHash={selectedCommit?.hash}
            onSelectCommit={selectCommit}
          />
        </div>
        <div className={styles['ig-divider-h']} onMouseDown={onGraphResize}>
          <div className={styles['ig-divider-h-handle']} />
        </div>
        <div className={styles['ig-detail-panel']}>
          <CommitDetail
            selectedCommit={selectedCommit}
            selectedCommitFiles={selectedCommitFiles}
            isBusy={isBusy}
          />
        </div>
      </div>
    </div>
  )
}

export default HistoryView
