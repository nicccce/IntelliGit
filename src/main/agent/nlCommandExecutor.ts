import { execFile } from 'child_process'
import { promisify } from 'util'
import type { GitExecResponse } from '../../shared/types'

const execFileAsync = promisify(execFile)

// 绝对禁止执行的参数组合（无论 riskLevel 如何，这里做最后兜底）
const BLOCKED_PATTERNS = [/--force(?!-with-lease)/, /--hard/, /-f$/, /clean/]

function isBlocked(args: string[]): boolean {
  const flat = args.join(' ')
  return BLOCKED_PATTERNS.some((re) => re.test(flat))
}

export async function executeGitCommand(
  repoPath: string,
  args: string[]
): Promise<GitExecResponse> {
  if (isBlocked(args)) {
    return { success: false, error: '该命令已被安全策略阻止，请手动执行' }
  }

  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd: repoPath,
      timeout: 30_000,
      maxBuffer: 1024 * 512
    })
    return {
      success: true,
      stdout: stdout.trim() || undefined,
      stderr: stderr.trim() || undefined
    }
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string }
    return {
      success: false,
      stderr: e.stderr?.trim() || undefined,
      error: e.message || String(err)
    }
  }
}
