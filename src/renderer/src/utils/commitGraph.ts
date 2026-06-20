import type { CommitRecord } from '../../../shared/types'

export const COMMIT_GRAPH_COLORS = [
  '#185fa5',
  '#1d9e75',
  '#7c5cc4',
  '#ba7517',
  '#e24b4a',
  '#6f7c12',
  '#2387a8',
  '#546179'
]

export function buildCommitLaneMap(commits: CommitRecord[]): Map<string, number> {
  const laneMap = new Map<string, number>()
  // 记录「某个父节点 hash 应该使用哪条 lane」
  const parentLaneHint = new Map<string, number>()
  let nextLane = 0

  for (const commit of commits) {
    // 如果某个子节点已经为这个 commit 预约了 lane，就用它；否则开新 lane
    const lane = parentLaneHint.has(commit.hash)
      ? parentLaneHint.get(commit.hash)!
      : nextLane++ % COMMIT_GRAPH_COLORS.length

    laneMap.set(commit.hash, lane)

    const parents = commit.parentHashes ?? []
    // 第一父节点继承同一条 lane（主线延续）
    if (parents[0] && !parentLaneHint.has(parents[0])) {
      parentLaneHint.set(parents[0], lane)
    }
    // 其余父节点（merge commit 的另一侧来源）开新 lane
    for (let i = 1; i < parents.length; i++) {
      if (!parentLaneHint.has(parents[i])) {
        parentLaneHint.set(parents[i], nextLane++ % COMMIT_GRAPH_COLORS.length)
      }
    }
  }

  return laneMap
}

export function getCommitLaneColor(laneMap: Map<string, number>, hash: string): string {
  const lane = laneMap.get(hash) || 0
  return COMMIT_GRAPH_COLORS[lane % COMMIT_GRAPH_COLORS.length]
}

export function isMergeCommit(commit: CommitRecord): boolean {
  return (commit.parentHashes?.length || 0) > 1
}
