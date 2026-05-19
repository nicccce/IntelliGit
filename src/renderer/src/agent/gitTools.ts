import { invokeGit } from '../api/gitClient'
import { GIT_TOOL_DEFINITIONS, GIT_TOOL_NAMES, toolRegistry, type GitToolName } from './toolRegistry'

// ─── Agent Git Tools 真实执行绑定 ─────────────────────────────────────────────

function getStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function getNumberArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key]
  return typeof value === 'number' ? value : undefined
}

function requireStringArg(args: Record<string, unknown>, key: string): string {
  const value = getStringArg(args, key)
  if (!value) throw new Error(`缺少必填参数: ${key}`)
  return value
}

const gitToolExecutors: Record<GitToolName, (args: Record<string, unknown>) => Promise<unknown>> = {
  [GIT_TOOL_NAMES.GET_STATUS]: async () => invokeGit('staging.status'),
  [GIT_TOOL_NAMES.GET_DIFF]: async (args) =>
    invokeGit('diff.workdir', { path: getStringArg(args, 'filePath') }),
  [GIT_TOOL_NAMES.GET_STAGED_DIFF]: async (args) =>
    invokeGit('diff.staged', { path: getStringArg(args, 'filePath') }),
  [GIT_TOOL_NAMES.GET_RAW_DIFF]: async (args) =>
    invokeGit('diff.workdirRaw', { path: getStringArg(args, 'filePath') }),
  [GIT_TOOL_NAMES.GET_RAW_STAGED_DIFF]: async (args) =>
    invokeGit('diff.stagedRaw', { path: getStringArg(args, 'filePath') }),
  [GIT_TOOL_NAMES.STAGE_FILE]: async (args) =>
    invokeGit('staging.add', { path: requireStringArg(args, 'filePath') }),
  [GIT_TOOL_NAMES.UNSTAGE_FILE]: async (args) =>
    invokeGit('staging.remove', { path: requireStringArg(args, 'filePath') }),
  [GIT_TOOL_NAMES.STAGE_ALL]: async () => invokeGit('staging.addAll'),
  [GIT_TOOL_NAMES.CREATE_COMMIT]: async (args) =>
    invokeGit('commit.create', { message: requireStringArg(args, 'message') }),
  [GIT_TOOL_NAMES.GET_COMMIT_LOG]: async (args) =>
    invokeGit('commit.log', { max: getNumberArg(args, 'max'), from: getStringArg(args, 'from') }),
  [GIT_TOOL_NAMES.GET_COMMIT_DETAIL]: async (args) =>
    invokeGit('commit.get', { hash: requireStringArg(args, 'hash') }),
  [GIT_TOOL_NAMES.GET_BRANCH_INFO]: async () => {
    const current = await invokeGit('branch.current')
    const branches = await invokeGit('branch.list')
    const remotes = await invokeGit('branch.listRemote')
    const aheadBehind = current.branch
      ? await invokeGit('branch.aheadBehind', { branch: current.branch })
      : undefined

    return { current, branches, remotes, aheadBehind }
  },
  [GIT_TOOL_NAMES.GET_MERGE_STATUS]: async () => invokeGit('merge.status'),
  [GIT_TOOL_NAMES.GET_CONFLICT_FILES]: async () => {
    const status = await invokeGit('merge.status')
    return status.conflictedFiles ?? []
  },
  [GIT_TOOL_NAMES.GET_TRIPLET_CONTENT]: async () => {
    throw new Error('当前 sidecar 尚未暴露三方内容读取命令，无法执行 git.getTripletContent')
  },
  [GIT_TOOL_NAMES.APPLY_PATCH]: async (args) =>
    invokeGit('staging.applyPatch', { patch: requireStringArg(args, 'patch') }),
  [GIT_TOOL_NAMES.UNSTAGE_HUNK]: async (args) =>
    invokeGit('staging.unstageHunk', { patch: requireStringArg(args, 'patch') }),
  [GIT_TOOL_NAMES.CONTINUE_MERGE]: async (args) =>
    invokeGit('merge.continue', { message: getStringArg(args, 'message') }),
  [GIT_TOOL_NAMES.ABORT_MERGE]: async () => invokeGit('merge.abort')
}

export function registerDefaultGitTools(): void {
  for (const [name, execute] of Object.entries(gitToolExecutors) as Array<
    [GitToolName, (args: Record<string, unknown>) => Promise<unknown>]
  >) {
    if (toolRegistry.has(name)) continue
    toolRegistry.register({
      definition: GIT_TOOL_DEFINITIONS[name],
      execute
    })
  }
}

registerDefaultGitTools()
