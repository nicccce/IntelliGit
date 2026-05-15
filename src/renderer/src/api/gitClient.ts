import type { GitCommandArgs, GitCommandName, GitCommandResult } from '../../../shared/types'

export class GitClientError extends Error {
  constructor(
    readonly command: string,
    message: string
  ) {
    super(message)
    this.name = 'GitClientError'
  }
}

export async function invokeGit<K extends GitCommandName>(
  command: K,
  ...args: GitCommandArgs<K>
): Promise<GitCommandResult<K>> {
  const payload = args[0] as Record<string, unknown> | undefined
  const response = await window.electronAPI.invokeGit(command, payload)

  if (!response.success) {
    throw new GitClientError(command, response.error || `Git 命令执行失败: ${command}`)
  }

  return response.data as GitCommandResult<K>
}

export async function canInvokeGit<K extends GitCommandName>(
  command: K,
  ...args: GitCommandArgs<K>
): Promise<boolean> {
  try {
    await invokeGit(command, ...args)
    return true
  } catch {
    return false
  }
}
