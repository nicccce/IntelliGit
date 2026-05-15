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
