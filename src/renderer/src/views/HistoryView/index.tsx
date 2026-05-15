import type { JSX } from 'react'
import { useEffect } from 'react'
import { Empty } from 'antd'

import { useHistoryViewModel } from '../../viewModels'
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

  useEffect(() => {
    if (currentRepo) fetchAllHistory()
  }, [currentRepo, fetchAllHistory])

  useEffect(() => {
    if (!currentRepo || allCommitHistory.length === 0) return

    const headCommit = allCommitHistory.find(
      (commit) => commit.refs && commit.refs.includes(currentBranch)
    )
    if (headCommit && (!selectedCommit || headCommit.hash !== selectedCommit.hash)) {
      selectCommit(headCommit)
    }
  }, [allCommitHistory, currentBranch, currentRepo, selectCommit, selectedCommit])

  if (!currentRepo) {
    return (
      <div className={styles['ig-empty-view']}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择仓库查看历史" />
      </div>
    )
  }

  return (
    <div className={styles['ig-history-view']} id="history-view">
      <BranchPanel branches={allBranches} />
      <CommitGraph
        commits={allCommitHistory}
        laneMap={laneMap}
        selectedCommitHash={selectedCommit?.hash}
        onSelectCommit={selectCommit}
      />
      <div className={styles['ig-detail-panel']}>
        <CommitDetail
          selectedCommit={selectedCommit}
          selectedCommitFiles={selectedCommitFiles}
          isBusy={isBusy}
        />
      </div>
    </div>
  )
}

export default HistoryView
