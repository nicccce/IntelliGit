import type {
  BranchInfo,
  CommitRecord,
  DiffEntry,
  FileStatusInfo,
  MergeStatusResult,
  PatchDetail,
  RemoteInfo,
  ResetMode
} from './git'
import type { SidecarPingResult } from './sidecar'

export interface RemoteOperationPayload {
  remote?: string
  url?: string
  username?: string
  password?: string
  sshKeyPath?: string
  sshPassword?: string
}

export type GitCommandMap = {
  'sidecar.ping': {
    payload: undefined
    result: SidecarPingResult
  }
  'repo.open': {
    payload: { path: string }
    result: { path: string }
  }
  'repo.init': {
    payload: { path: string; bare?: boolean }
    result: { path: string }
  }
  'repo.clone': {
    payload: { url: string; path: string; depth?: number; branch?: string }
    result: { path: string }
  }
  'repo.head': {
    payload: undefined
    result: { hash: string; branch: string }
  }
  'repo.isClean': {
    payload: undefined
    result: { clean: boolean }
  }
  'staging.status': {
    payload: undefined
    result: FileStatusInfo[]
  }
  'staging.add': {
    payload: { path: string }
    result: void
  }
  'staging.addAll': {
    payload: undefined
    result: void
  }
  'staging.remove': {
    payload: { path: string }
    result: void
  }
  'staging.restore': {
    payload: { path: string }
    result: void
  }
  'staging.applyPatch': {
    payload: { patch: string }
    result: void
  }
  'staging.unstageHunk': {
    payload: { patch: string }
    result: void
  }
  'commit.create': {
    payload: { message: string; authorName?: string; authorEmail?: string }
    result: { hash: string }
  }
  'commit.log': {
    payload: { max?: number; from?: string }
    result: CommitRecord[]
  }
  'commit.logAll': {
    payload: { max?: number }
    result: CommitRecord[]
  }
  'commit.get': {
    payload: { hash: string }
    result: CommitRecord
  }
  'commit.reset': {
    payload: { hash: string; mode?: ResetMode | string }
    result: void
  }
  'commit.checkoutCommit': {
    payload: { hash: string }
    result: void
  }
  'branch.list': {
    payload: undefined
    result: BranchInfo[]
  }
  'branch.listRemote': {
    payload: undefined
    result: BranchInfo[]
  }
  'branch.current': {
    payload: undefined
    result: { branch: string }
  }
  'branch.aheadBehind': {
    payload: { branch: string }
    result: { ahead: number; behind: number }
  }
  'branch.create': {
    payload: { name: string }
    result: void
  }
  'branch.delete': {
    payload: { name: string }
    result: void
  }
  'branch.checkout': {
    payload: { branch: string }
    result: void
  }
  'branch.checkoutNew': {
    payload: { branch: string; startFrom?: string }
    result: void
  }
  'remote.list': {
    payload: undefined
    result: RemoteInfo[]
  }
  'remote.add': {
    payload: { name: string; url: string }
    result: void
  }
  'remote.setUrl': {
    payload: { name?: string; url: string }
    result: void
  }
  'remote.remove': {
    payload: { name: string }
    result: void
  }
  'remote.fetch': {
    payload: RemoteOperationPayload | undefined
    result: void
  }
  'remote.pull': {
    payload: RemoteOperationPayload | undefined
    result: void
  }
  'remote.push': {
    payload: RemoteOperationPayload | undefined
    result: void
  }
  'merge.status': {
    payload: undefined
    result: MergeStatusResult
  }
  'merge.abort': {
    payload: undefined
    result: void
  }
  'merge.continue': {
    payload: { message?: string }
    result: void
  }
  'diff.commits': {
    payload: { hashA: string; hashB: string }
    result: PatchDetail
  }
  'diff.withParent': {
    payload: { hash: string }
    result: DiffEntry[]
  }
  'diff.commitPatch': {
    payload: { hash: string }
    result: PatchDetail
  }
  'diff.fileContent': {
    payload: { hash: string; path: string }
    result: { content: string }
  }
  'diff.listFiles': {
    payload: { hash: string }
    result: string[]
  }
  'diff.workdir': {
    payload: { path?: string }
    result: PatchDetail
  }
  'diff.staged': {
    payload: { path?: string }
    result: PatchDetail
  }
  'diff.workdirRaw': {
    payload: { path?: string }
    result: { diff: string }
  }
  'diff.stagedRaw': {
    payload: { path?: string }
    result: { diff: string }
  }
}

export type GitCommandName = keyof GitCommandMap
export type GitCommandPayload<K extends GitCommandName> = GitCommandMap[K]['payload']
export type GitCommandResult<K extends GitCommandName> = GitCommandMap[K]['result']
export type GitCommandArgs<K extends GitCommandName> =
  GitCommandPayload<K> extends undefined ? [payload?: undefined] : [payload: GitCommandPayload<K>]
