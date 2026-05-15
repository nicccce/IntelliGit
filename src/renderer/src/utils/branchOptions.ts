import type { BranchInfo } from '../../../shared/types'

export interface BranchPickerOption {
  name: string
  isHead: boolean
  isRemoteOnly: boolean
}

export function buildBranchPickerOptions(
  branches: BranchInfo[],
  remoteBranches: BranchInfo[]
): BranchPickerOption[] {
  const localBranchNames = new Set(branches.map((branch) => branch.name))
  const remoteOnlyBranches = remoteBranches
    .filter((branch) => !localBranchNames.has(branch.name.replace(/^origin\//, '')))
    .map((branch) => ({
      name: branch.name.replace(/^origin\//, ''),
      isHead: branch.isHead,
      isRemoteOnly: true
    }))

  return [
    ...branches
      .filter((branch) => !branch.isRemote)
      .map((branch) => ({
        name: branch.name,
        isHead: branch.isHead,
        isRemoteOnly: false
      })),
    ...remoteOnlyBranches
  ]
}

export function hasLocalBranch(branches: BranchInfo[], branch: string): boolean {
  return branches.some((item) => item.name === branch)
}

export function findRemoteBranch(
  remoteBranches: BranchInfo[],
  branch: string
): BranchInfo | undefined {
  const remoteRefName = `origin/${branch}`
  return remoteBranches.find((item) => item.name === remoteRefName)
}
