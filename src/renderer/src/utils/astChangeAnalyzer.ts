export interface AstChangeInsight {
  filePath: string
  language: 'typescript' | 'javascript' | 'tsx' | 'jsx' | 'python' | 'json' | 'other'
  changeKinds: string[]
  symbols: string[]
  hunks: string[]
  summary: string
}

interface FileDiffSection {
  filePath: string
  diff: string
  hunks: Array<{ header: string; body: string }>
}

const MAX_INSIGHTS = 8
const MAX_SYMBOLS_PER_FILE = 10
const MAX_HUNKS_PER_FILE = 6

function detectLanguage(filePath: string): AstChangeInsight['language'] {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.tsx')) return 'tsx'
  if (lower.endsWith('.ts')) return 'typescript'
  if (lower.endsWith('.jsx')) return 'jsx'
  if (lower.endsWith('.js')) return 'javascript'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.json')) return 'json'
  return 'other'
}

function parseFileDiffs(diff: string): FileDiffSection[] {
  const sections: FileDiffSection[] = []
  const chunks = diff.split(/^diff --git /m).filter(Boolean)

  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    const header = lines[0] || ''
    const pathMatch = header.match(/a\/(.+?)\s+b\/(.+?)$/)
    const filePath = pathMatch?.[2] || pathMatch?.[1]
    if (!filePath) continue

    const hunks: FileDiffSection['hunks'] = []
    let index = 0
    while (index < lines.length) {
      if (!lines[index].startsWith('@@')) {
        index++
        continue
      }
      const hunkHeader = lines[index]
      const start = index
      index++
      while (index < lines.length && !lines[index].startsWith('@@')) index++
      hunks.push({ header: hunkHeader, body: lines.slice(start, index).join('\n') })
    }

    sections.push({ filePath, diff: chunk, hunks })
  }

  return sections
}

function collectMatches(diff: string, patterns: RegExp[]): string[] {
  const symbols = new Set<string>()
  for (const line of diff.split('\n')) {
    const normalized = line.replace(/^[+\- ]\s*/, '')
    for (const pattern of patterns) {
      const match = normalized.match(pattern)
      if (match?.[1]) symbols.add(match[1])
    }
  }
  return [...symbols]
}

function extractSymbols(filePath: string, diff: string): string[] {
  const language = detectLanguage(filePath)
  const jsLikePatterns = [
    /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
    /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/,
    /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/,
    /([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?\([^)]*\)\s*=>/,
    /(?:public|private|protected)?\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[{:]/
  ]
  const pythonPatterns = [
    /def\s+([A-Za-z_][\w]*)\s*\(/,
    /class\s+([A-Za-z_][\w]*)\s*[:(]/
  ]
  const jsonPatterns = [/"([A-Za-z_][\w.-]*)"\s*:/]

  const patterns = language === 'python' ? pythonPatterns : language === 'json' ? jsonPatterns : jsLikePatterns
  return collectMatches(diff, patterns).slice(0, MAX_SYMBOLS_PER_FILE)
}

function inferChangeKinds(section: FileDiffSection): string[] {
  const kinds = new Set<string>()
  const diff = section.diff
  if (/new file mode|--- \/dev\/null/.test(diff)) kinds.add('新增文件')
  if (/deleted file mode|\+\+\+ \/dev\/null/.test(diff)) kinds.add('删除文件')
  if (/rename from|rename to/.test(diff)) kinds.add('重命名')
  if (/^[+]\s*(?:export\s+)?(?:async\s+)?function\s+/m.test(diff) || /^[+]\s*(?:export\s+)?const\s+\w+\s*=\s*(?:async\s*)?\(/m.test(diff)) kinds.add('函数变更')
  if (/^[+]\s*(?:export\s+)?(?:abstract\s+)?class\s+/m.test(diff)) kinds.add('类变更')
  if (/^[+]\s*(?:export\s+)?(?:interface|type)\s+/m.test(diff)) kinds.add('类型定义')
  if (/^[+]\s*<(?:[A-Z][\w.]*|[a-z][\w-]*)/m.test(diff) || /\.tsx$|\.jsx$/i.test(section.filePath)) kinds.add('UI 组件')
  if (/^[+]\s*(?:it|test|describe)\s*\(/m.test(diff) || /(?:test|spec)\.[tj]sx?$/i.test(section.filePath)) kinds.add('测试')
  if (section.hunks.length > 1) kinds.add('多处 Hunk')
  if (kinds.size === 0) kinds.add('内容调整')
  return [...kinds]
}

export function analyzeAstChanges(files: string[], diff: string): AstChangeInsight[] {
  const fileSet = new Set(files)
  const sections = parseFileDiffs(diff).filter((section) => fileSet.size === 0 || fileSet.has(section.filePath))

  return sections.slice(0, MAX_INSIGHTS).map((section) => {
    const symbols = extractSymbols(section.filePath, section.diff)
    const language = detectLanguage(section.filePath)
    const changeKinds = inferChangeKinds(section)
    const hunks = section.hunks.map((hunk) => `${section.filePath}@@${hunk.header}`).slice(0, MAX_HUNKS_PER_FILE)
    const symbolText = symbols.length ? `，涉及 ${symbols.join('、')}` : ''
    const summary = `${section.filePath}：${changeKinds.join('、')}${symbolText}`
    return { filePath: section.filePath, language, changeKinds, symbols, hunks, summary }
  })
}

export function renderAstContext(files: string[], diff: string): string | undefined {
  if (!diff.trim()) return undefined
  const insights = analyzeAstChanges(files, diff)
  if (!insights.length) return undefined

  return insights
    .map((insight) => {
      const symbolText = insight.symbols.length ? insight.symbols.join(', ') : '无明确符号'
      const hunkText = insight.hunks.length ? insight.hunks.join(' | ') : '无明确 Hunk'
      return `- [${insight.language}] ${insight.summary}\n  变更类型：${insight.changeKinds.join(', ')}\n  关注符号：${symbolText}\n  Hunk 标识：${hunkText}`
    })
    .join('\n')
}
