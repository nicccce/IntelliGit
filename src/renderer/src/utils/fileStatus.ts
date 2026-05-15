import type { FileStatusInfo } from '../../../shared/types'

export function isStagedFile(file: FileStatusInfo): boolean {
  return file.staging !== ' ' && file.staging !== '?'
}

export function isUnstagedFile(file: FileStatusInfo): boolean {
  return file.worktree !== ' ' || file.staging === '?'
}

export function hasWorkingTreeChange(file: FileStatusInfo): boolean {
  return file.staging !== ' ' || file.worktree !== ' '
}

export function splitFileStatuses(fileStatuses: FileStatusInfo[]): {
  staged: FileStatusInfo[]
  unstaged: FileStatusInfo[]
} {
  return {
    staged: fileStatuses.filter(isStagedFile),
    unstaged: fileStatuses.filter(isUnstagedFile)
  }
}

export function countChangedFiles(fileStatuses: FileStatusInfo[]): number {
  return fileStatuses.filter(hasWorkingTreeChange).length
}

export function statusColor(code: string): string {
  switch (code) {
    case 'M':
      return 'var(--accent-orange)'
    case 'A':
      return 'var(--accent-green)'
    case 'D':
      return 'var(--accent-red)'
    case '?':
      return 'var(--accent-green)'
    default:
      return 'var(--text-secondary)'
  }
}

export function statusLabel(code: string): string {
  switch (code) {
    case 'M':
      return 'M'
    case 'A':
      return 'A'
    case 'D':
      return 'D'
    case 'R':
      return 'R'
    case '?':
      return 'U'
    default:
      return ' '
  }
}
