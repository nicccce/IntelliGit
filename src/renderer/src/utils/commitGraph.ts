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
  let nextLane = 0

  commits.forEach((commit) => {
    if (laneMap.has(commit.hash)) return

    const refLane =
      commit.refs && commit.refs.length > 0
        ? commit.refs[0]
        : commit.parentHashes?.[0] || commit.hash

    if (!laneMap.has(refLane)) {
      laneMap.set(refLane, nextLane++ % COMMIT_GRAPH_COLORS.length)
    }

    laneMap.set(commit.hash, laneMap.get(refLane) || 0)
  })

  return laneMap
}

export function getCommitLaneColor(laneMap: Map<string, number>, hash: string): string {
  const lane = laneMap.get(hash) || 0
  return COMMIT_GRAPH_COLORS[lane % COMMIT_GRAPH_COLORS.length]
}

export function isMergeCommit(commit: CommitRecord): boolean {
  return (commit.parentHashes?.length || 0) > 1
}
