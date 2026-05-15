export interface FileStatusInfo {
  path: string
  staging: string
  worktree: string
}

export interface CommitRecord {
  hash: string
  shortHash: string
  author: string
  authorEmail: string
  date: string
  message: string
  parentHashes: string[]
  refs?: string[]
}

export interface BranchInfo {
  name: string
  isRemote: boolean
  isHead: boolean
  hash: string
}

export interface DiffEntry {
  action: string
  from: string
  to: string
}

export interface RemoteInfo {
  name: string
  fetchUrl: string
  pushUrls: string[]
}

export interface PatchDetail {
  filePatches: FilePatchInfo[]
}

export interface FilePatchInfo {
  isBinary: boolean
  fromPath: string
  toPath: string
  chunks: ChunkInfo[]
}

export interface ChunkInfo {
  content: string
  type: 'Add' | 'Delete' | 'Equal'
}

export interface MergeConflictInfo {
  conflictedFiles: string[]
  message: string
  mergingBranch: string
}

export interface MergeStatusResult {
  merging: boolean
  conflictedFiles?: string[]
  mergeHead?: string
}

export type ResetMode = 'soft' | 'mixed' | 'hard'
