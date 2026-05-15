export function repoInitials(name: string): string {
  const parts = name
    .replace(/\.git$/i, '')
    .split(/[\s._-]+/)
    .filter(Boolean)

  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }

  return (parts[0] || name || 'IG').slice(0, 2).toUpperCase()
}
