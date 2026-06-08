export interface AstHunkInsight {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  addedLines: number
  deletedLines: number
  contextLines: number
  symbols: string[]
  summary: string
}

export interface AstChangeInsight {
  filePath: string
  oldPath?: string
  language: 'typescript' | 'javascript' | 'tsx' | 'jsx' | 'python' | 'json' | 'other'
  status: 'added' | 'deleted' | 'renamed' | 'modified'
  changeKinds: string[]
  symbols: string[]
  hunks: string[]
  hunkInsights: AstHunkInsight[]
  summary: string
}

interface FileDiffSection {
  filePath: string
  oldPath?: string
  diff: string
  hunks: Array<{ header: string; body: string }>
  status: AstChangeInsight['status']
}

const MAX_INSIGHTS = 8
const MAX_SYMBOLS_PER_FILE = 10
const MAX_HUNKS_PER_FILE = 6
const MAX_SYMBOLS_PER_HUNK = 5

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
    const oldPath = pathMatch?.[1]
    const filePath = pathMatch?.[2] || oldPath
    if (!filePath) continue

    const sectionDiff = `diff --git ${chunk}`
    const isAdded = /new file mode|--- \/dev\/null/m.test(sectionDiff)
    const isDeleted = /deleted file mode|\+\+\+ \/dev\/null/m.test(sectionDiff)
    const isRenamed = /rename from|rename to/m.test(sectionDiff) || Boolean(oldPath && oldPath !== filePath)
    const status: AstChangeInsight['status'] = isAdded
      ? 'added'
      : isDeleted
        ? 'deleted'
        : isRenamed
          ? 'renamed'
          : 'modified'

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

    sections.push({ filePath, oldPath, diff: sectionDiff, hunks, status })
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

function getSymbolPatterns(filePath: string): RegExp[] {
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
  const pythonPatterns = [/def\s+([A-Za-z_][\w]*)\s*\(/, /class\s+([A-Za-z_][\w]*)\s*[:(]/]
  const jsonPatterns = [/"([A-Za-z_][\w.-]*)"\s*:/]
  return language === 'python' ? pythonPatterns : language === 'json' ? jsonPatterns : jsLikePatterns
}

function extractSymbols(filePath: string, diff: string, limit = MAX_SYMBOLS_PER_FILE): string[] {
  return collectMatches(diff, getSymbolPatterns(filePath)).slice(0, limit)
}

function parseHunkRange(header: string): Pick<AstHunkInsight, 'oldStart' | 'oldLines' | 'newStart' | 'newLines'> {
  const match = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/)
  return {
    oldStart: Number(match?.[1] ?? 0),
    oldLines: Number(match?.[2] ?? (match ? 1 : 0)),
    newStart: Number(match?.[3] ?? 0),
    newLines: Number(match?.[4] ?? (match ? 1 : 0))
  }
}

function analyzeHunks(section: FileDiffSection): AstHunkInsight[] {
  return section.hunks.slice(0, MAX_HUNKS_PER_FILE).map((hunk) => {
    const lines = hunk.body.split('\n').slice(1)
    const addedLines = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
    const deletedLines = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length
    const contextLines = lines.filter((line) => line.startsWith(' ')).length
    const symbols = extractSymbols(section.filePath, hunk.body, MAX_SYMBOLS_PER_HUNK)
    const range = parseHunkRange(hunk.header)
    const summaryParts = [`+${addedLines}`, `-${deletedLines}`]
    if (symbols.length) summaryParts.push(`符号 ${symbols.join('、')}`)
    return {
      header: hunk.header,
      ...range,
      addedLines,
      deletedLines,
      contextLines,
      symbols,
      summary: `${hunk.header}（${summaryParts.join('，')}）`
    }
  })
}

function inferChangeKinds(section: FileDiffSection): string[] {
  const kinds = new Set<string>()
  const diff = section.diff
  if (section.status === 'added') kinds.add('新增文件')
  if (section.status === 'deleted') kinds.add('删除文件')
  if (section.status === 'renamed') kinds.add('重命名')
  if (/^[+]\s*(?:export\s+)?(?:async\s+)?function\s+/m.test(diff) || /^[+]\s*(?:export\s+)?const\s+\w+\s*=\s*(?:async\s*)?\(/m.test(diff)) kinds.add('函数变更')
  if (/^[+]\s*(?:export\s+)?(?:abstract\s+)?class\s+/m.test(diff)) kinds.add('类变更')
  if (/^[+]\s*(?:export\s+)?(?:interface|type)\s+/m.test(diff)) kinds.add('类型定义')
  if (/^[+]\s*<(?:[A-Z][\w.]*|[a-z][\w-]*)/m.test(diff) || /\.tsx$|\.jsx$/i.test(section.filePath)) kinds.add('UI 组件')
  if (/^[+]\s*(?:it|test|describe)\s*\(/m.test(diff) || /(?:test|spec)\.[tj]sx?$/i.test(section.filePath)) kinds.add('测试')
  if (/^[+]\s*(?:import|from)\s+/m.test(diff) || /^[-]\s*(?:import|from)\s+/m.test(diff)) kinds.add('依赖调整')
  if (section.hunks.length > 1) kinds.add('多处 Hunk')
  if (kinds.size === 0) kinds.add('内容调整')
  return [...kinds]
}

export function analyzeAstChanges(files: string[], diff: string): AstChangeInsight[] {
  const fileSet = new Set(files)
  const sections = parseFileDiffs(diff).filter(
    (section) => fileSet.size === 0 || fileSet.has(section.filePath) || Boolean(section.oldPath && fileSet.has(section.oldPath))
  )

  return sections.slice(0, MAX_INSIGHTS).map((section) => {
    const symbols = extractSymbols(section.filePath, section.diff)
    const language = detectLanguage(section.filePath)
    const changeKinds = inferChangeKinds(section)
    const hunkInsights = analyzeHunks(section)
    const hunks = hunkInsights.map((hunk) => `${section.filePath}@@${hunk.header}`)
    const symbolText = symbols.length ? `，涉及 ${symbols.join('、')}` : ''
    const hunkText = hunkInsights.length ? `，${hunkInsights.length} 个 Hunk` : ''
    const summary = `${section.filePath}：${changeKinds.join('、')}${symbolText}${hunkText}`
    return {
      filePath: section.filePath,
      oldPath: section.oldPath,
      language,
      status: section.status,
      changeKinds,
      symbols,
      hunks,
      hunkInsights,
      summary
    }
  })
}

export function renderAstContext(files: string[], diff: string): string | undefined {
  if (!diff.trim()) return undefined
  const insights = analyzeAstChanges(files, diff)
  if (!insights.length) return undefined

  return insights
    .map((insight) => {
      const symbolText = insight.symbols.length ? insight.symbols.join(', ') : '无明确符号'
      const hunkText = insight.hunkInsights.length
        ? insight.hunkInsights.map((hunk) => hunk.summary).join(' | ')
        : '无明确 Hunk'
      return `- [${insight.language}/${insight.status}] ${insight.summary}\n  变更类型：${insight.changeKinds.join(', ')}\n  关注符号：${symbolText}\n  Hunk 摘要：${hunkText}`
    })
    .join('\n')
}
