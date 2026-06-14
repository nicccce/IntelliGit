import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import generate from '@babel/generator'
import type { Node } from '@babel/types'

export interface AstSymbolInfo {
  name: string
  kind: string
  startLine: number
  endLine: number
  signature?: string
  bodyHash?: string
  params?: string
  returnType?: string
  fields?: string[]
  confidence?: 'high' | 'medium' | 'low'
  key?: string
}

export interface AstSymbolChange {
  kind: 'added-symbol' | 'deleted-symbol' | 'modified-body' | 'modified-params' | 'modified-return-type' | 'modified-fields'
  symbol: AstSymbolInfo
  oldSymbol?: AstSymbolInfo
  newSymbol?: AstSymbolInfo
  summary: string
}

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
  astSymbols: AstSymbolInfo[]
  oldAstSymbols: AstSymbolInfo[]
  newAstSymbols: AstSymbolInfo[]
  owner?: AstSymbolInfo
  oldOwner?: AstSymbolInfo
  newOwner?: AstSymbolInfo
  ownerLabel?: string
  confidence?: 'high' | 'medium' | 'low'
  summary: string
}

export interface AstChangeInsight {
  filePath: string
  oldPath?: string
  language: 'typescript' | 'javascript' | 'tsx' | 'jsx' | 'python' | 'json' | 'other'
  status: 'added' | 'deleted' | 'renamed' | 'modified'
  changeKinds: string[]
  symbols: string[]
  astSymbols: AstSymbolInfo[]
  oldAstSymbols: AstSymbolInfo[]
  newAstSymbols: AstSymbolInfo[]
  symbolChanges: AstSymbolChange[]
  hunks: string[]
  hunkInsights: AstHunkInsight[]
  confidence?: 'high' | 'medium' | 'low'
  summary: string
}

export interface SemanticConflictRisk {
  level: 'low' | 'medium' | 'high'
  type: '调用-删除冲突' | '签名变更冲突' | '语义覆盖冲突' | '类型不兼容冲突' | '范围调整'
  description: string
  files: string[]
  symbols: string[]
  evidence: string[]
}

interface FileDiffSection {
  filePath: string
  oldPath?: string
  diff: string
  hunks: Array<{ header: string; body: string }>
  status: AstChangeInsight['status']
}

export interface AstFileContentPair {
  oldContent?: string
  newContent?: string
}

export type AstFileContentMap = Record<string, AstFileContentPair>

const MAX_INSIGHTS = 8
const MAX_SYMBOLS_PER_FILE = 10
const MAX_HUNKS_PER_FILE = 6
const MAX_SYMBOLS_PER_HUNK = 5

const JS_LIKE_LANGUAGES = new Set<AstChangeInsight['language']>([
  'typescript',
  'javascript',
  'tsx',
  'jsx'
])

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

function stripDiffLinePrefix(line: string): string | undefined {
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('\\ No newline')) return undefined
  if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) return line.slice(1)
  return undefined
}

function buildApproximateSourceFromDiff(section: FileDiffSection, side: 'old' | 'new'): string {
  const sourceLines: string[] = []
  for (const hunk of section.hunks) {
    const range = parseHunkRange(hunk.header)
    const targetStart = side === 'new' ? range.newStart : range.oldStart
    while (sourceLines.length < Math.max(0, targetStart - 1)) sourceLines.push('')

    for (const line of hunk.body.split('\n').slice(1)) {
      if (side === 'new' && line.startsWith('-')) continue
      if (side === 'old' && line.startsWith('+')) continue
      const content = stripDiffLinePrefix(line)
      if (content !== undefined) sourceLines.push(content)
    }
  }
  return sourceLines.join('\n')
}

function getBabelPlugins(language: AstChangeInsight['language']): NonNullable<Parameters<typeof parse>[1]>['plugins'] {
  const plugins: NonNullable<Parameters<typeof parse>[1]>['plugins'] = [
    'decorators-legacy',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'objectRestSpread',
    'optionalChaining',
    'nullishCoalescingOperator',
    'dynamicImport',
    'importMeta'
  ]
  if (language === 'typescript' || language === 'tsx') plugins.push('typescript')
  if (language === 'tsx' || language === 'jsx') plugins.push('jsx')
  return plugins
}

function getNodeLineRange(node: Node): Pick<AstSymbolInfo, 'startLine' | 'endLine'> | undefined {
  const startLine = node.loc?.start.line
  const endLine = node.loc?.end.line
  if (!startLine || !endLine) return undefined
  return { startLine, endLine }
}

function codeOf(node: Node | null | undefined): string {
  if (!node) return ''
  try {
    return generate(node, { comments: false, compact: true }).code
  } catch {
    return node.type
  }
}

function normalizeForHash(value: string): string {
  return value
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function hashText(value: string): string {
  const normalized = normalizeForHash(value)
  let hash = 0
  for (let index = 0; index < normalized.length; index++) {
    hash = (hash * 31 + normalized.charCodeAt(index)) | 0
  }
  return String(hash)
}

function buildSymbolKey(
  name: string,
  kind: string,
  range: Pick<AstSymbolInfo, 'startLine' | 'endLine'>,
  signature?: string
): string {
  return `${kind}:${name}:${range.startLine}-${range.endLine}:${signature || ''}`
}

function pushAstSymbol(
  symbols: AstSymbolInfo[],
  name: string | undefined,
  kind: string,
  node: Node,
  details: Partial<AstSymbolInfo> = {}
): void {
  if (!name) return
  const range = getNodeLineRange(node)
  if (!range) return
  const key = buildSymbolKey(name, kind, range, details.signature)
  symbols.push({ name, kind, ...range, ...details, key })
}

function paramText(params: Node[] | undefined): string {
  return (params || []).map((param) => codeOf(param)).join(',')
}

function getSymbolConfidence(kind: string, details: Partial<AstSymbolInfo>): AstSymbolInfo['confidence'] {
  if (kind === 'interface' || kind === 'type') return 'high'
  if (kind === 'class') return 'high'
  if (kind === 'function' && (details.signature || details.params)) return 'high'
  if (kind === 'method' && (details.signature || details.params)) return 'high'
  if (kind === 'variable' && details.bodyHash) return 'medium'
  return 'low'
}

function returnTypeText(node: { returnType?: Node | null; typeAnnotation?: Node | null }): string {
  return codeOf(node.returnType || node.typeAnnotation)
}

function functionSignature(name: string | undefined, params: Node[] | undefined, returnType: string): string {
  return `${name || '<anonymous>'}(${paramText(params)}):${returnType}`
}

function interfaceFields(members: Array<Node>): string[] {
  return members
    .map((member) => codeOf(member))
    .filter(Boolean)
    .sort()
}

function extractAstSymbols(filePath: string, source: string): AstSymbolInfo[] {
  const language = detectLanguage(filePath)
  if (!JS_LIKE_LANGUAGES.has(language) || !source.trim()) return []

  try {
    const ast = parse(source, {
      sourceType: 'unambiguous',
      plugins: getBabelPlugins(language),
      errorRecovery: true
    })
    const symbols: AstSymbolInfo[] = []

    traverse(ast, {
      FunctionDeclaration(path) {
        const returnType = returnTypeText(path.node)
        const details = {
          params: paramText(path.node.params),
          returnType,
          bodyHash: hashText(codeOf(path.node.body)),
          signature: functionSignature(path.node.id?.name, path.node.params, returnType)
        }
        pushAstSymbol(symbols, path.node.id?.name, 'function', path.node, {
          ...details,
          confidence: getSymbolConfidence('function', details)
        })
      },
      ClassDeclaration(path) {
        const details = { bodyHash: hashText(codeOf(path.node.body)) }
        pushAstSymbol(symbols, path.node.id?.name, 'class', path.node, {
          ...details,
          confidence: getSymbolConfidence('class', details)
        })
      },
      TSInterfaceDeclaration(path) {
        const details = {
          fields: interfaceFields(path.node.body.body as unknown as Node[]),
          bodyHash: hashText(codeOf(path.node.body))
        }
        pushAstSymbol(symbols, path.node.id.name, 'interface', path.node, {
          ...details,
          confidence: getSymbolConfidence('interface', details)
        })
      },
      TSTypeAliasDeclaration(path) {
        const annotation = path.node.typeAnnotation
        const fields = annotation.type === 'TSTypeLiteral' ? interfaceFields(annotation.members as unknown as Node[]) : undefined
        const details = {
          fields,
          bodyHash: hashText(codeOf(annotation))
        }
        pushAstSymbol(symbols, path.node.id.name, 'type', path.node, {
          ...details,
          confidence: getSymbolConfidence('type', details)
        })
      },
      VariableDeclarator(path) {
        if (path.node.id.type !== 'Identifier') return
        const init = path.node.init
        const initType = init?.type
        const kind = initType === 'ArrowFunctionExpression' || initType === 'FunctionExpression' ? 'function' : 'variable'
        const details = init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')
          ? {
              params: paramText(init.params),
              returnType: returnTypeText(init),
              bodyHash: hashText(codeOf(init.body)),
              signature: `${path.node.id.name}(${paramText(init.params)}):${returnTypeText(init)}`
            }
          : { bodyHash: hashText(codeOf(init)) }
        pushAstSymbol(symbols, path.node.id.name, kind, path.node, {
          ...details,
          confidence: getSymbolConfidence(kind, details)
        })
      },
      ObjectMethod(path) {
        const key = path.node.key
        const name = key.type === 'Identifier' ? key.name : key.type === 'StringLiteral' ? key.value : undefined
        const details = {
          params: paramText(path.node.params),
          returnType: returnTypeText(path.node),
          bodyHash: hashText(codeOf(path.node.body)),
          signature: functionSignature(name, path.node.params, returnTypeText(path.node))
        }
        pushAstSymbol(symbols, name, 'method', path.node, {
          ...details,
          confidence: getSymbolConfidence('method', details)
        })
      },
      ClassMethod(path) {
        const key = path.node.key
        const name = key.type === 'Identifier' ? key.name : key.type === 'StringLiteral' ? key.value : undefined
        const details = {
          params: paramText(path.node.params),
          returnType: returnTypeText(path.node),
          bodyHash: hashText(codeOf(path.node.body)),
          signature: functionSignature(name, path.node.params, returnTypeText(path.node))
        }
        pushAstSymbol(symbols, name, 'method', path.node, {
          ...details,
          confidence: getSymbolConfidence('method', details)
        })
      },
      TSDeclareFunction(path) {
        const details = {
          params: paramText(path.node.params),
          returnType: returnTypeText(path.node),
          signature: functionSignature(path.node.id?.name, path.node.params, returnTypeText(path.node))
        }
        pushAstSymbol(symbols, path.node.id?.name, 'function', path.node, {
          ...details,
          confidence: getSymbolConfidence('function', details)
        })
      },
      ArrowFunctionExpression(path) {
        if (path.parent.type !== 'VariableDeclarator' && path.parent.type !== 'AssignmentExpression') return
        const name = path.parent.type === 'VariableDeclarator' && path.parent.id.type === 'Identifier'
          ? path.parent.id.name
          : path.parent.type === 'AssignmentExpression' && path.parent.left.type === 'Identifier'
            ? path.parent.left.name
            : undefined
        if (!name) return
        const details = {
          params: paramText(path.node.params),
          returnType: returnTypeText(path.node),
          bodyHash: hashText(codeOf(path.node.body)),
          signature: functionSignature(name, path.node.params, returnTypeText(path.node))
        }
        pushAstSymbol(symbols, name, 'function', path.node, {
          ...details,
          confidence: getSymbolConfidence('function', details)
        })
      },
      CallExpression(path) {
        const callee = path.node.callee
        if (callee.type !== 'Identifier') return
        if (!['memo', 'forwardRef'].includes(callee.name)) return
        const firstArg = path.node.arguments[0]
        if (!firstArg || firstArg.type !== 'ArrowFunctionExpression' && firstArg.type !== 'FunctionExpression') return
        const details = {
          params: paramText(firstArg.params),
          returnType: returnTypeText(firstArg),
          bodyHash: hashText(codeOf(firstArg.body)),
          signature: `${callee.name}(${paramText(firstArg.params)}):${returnTypeText(firstArg)}`
        }
        pushAstSymbol(symbols, callee.name, 'component', path.node, {
          ...details,
          confidence: 'medium'
        })
      }
    })

    const seen = new Set<string>()
    return symbols.filter((symbol) => {
      const key = `${symbol.kind}:${symbol.name}:${symbol.startLine}:${symbol.endLine}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  } catch {
    return []
  }
}

function symbolKey(symbol: AstSymbolInfo): string {
  return symbol.key || `${symbol.kind}:${symbol.name}:${symbol.startLine}-${symbol.endLine}:${symbol.signature || ''}`
}

function sameFields(a?: string[], b?: string[]): boolean {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort())
}

function diffAstSymbols(oldSymbols: AstSymbolInfo[], newSymbols: AstSymbolInfo[]): AstSymbolChange[] {
  const changes: AstSymbolChange[] = []
  const oldMap = new Map(oldSymbols.map((symbol) => [symbolKey(symbol), symbol]))
  const newMap = new Map(newSymbols.map((symbol) => [symbolKey(symbol), symbol]))

  for (const symbol of newSymbols) {
    if (!oldMap.has(symbolKey(symbol))) {
      changes.push({ kind: 'added-symbol', symbol, newSymbol: symbol, summary: `新增 ${symbol.kind}:${symbol.name}` })
    }
  }

  for (const symbol of oldSymbols) {
    if (!newMap.has(symbolKey(symbol))) {
      changes.push({ kind: 'deleted-symbol', symbol, oldSymbol: symbol, summary: `删除 ${symbol.kind}:${symbol.name}` })
    }
  }

  for (const [key, oldSymbol] of oldMap) {
    const newSymbol = newMap.get(key)
    if (!newSymbol) continue
    if ((oldSymbol.params || '') !== (newSymbol.params || '')) {
      changes.push({ kind: 'modified-params', symbol: newSymbol, oldSymbol, newSymbol, summary: `修改参数 ${newSymbol.kind}:${newSymbol.name}` })
    }
    if ((oldSymbol.returnType || '') !== (newSymbol.returnType || '')) {
      changes.push({ kind: 'modified-return-type', symbol: newSymbol, oldSymbol, newSymbol, summary: `修改返回类型 ${newSymbol.kind}:${newSymbol.name}` })
    }
    if (!sameFields(oldSymbol.fields, newSymbol.fields)) {
      changes.push({ kind: 'modified-fields', symbol: newSymbol, oldSymbol, newSymbol, summary: `修改字段 ${newSymbol.kind}:${newSymbol.name}` })
    }
    if ((oldSymbol.bodyHash || '') !== (newSymbol.bodyHash || '')) {
      changes.push({ kind: 'modified-body', symbol: newSymbol, oldSymbol, newSymbol, summary: `修改函数体/结构 ${newSymbol.kind}:${newSymbol.name}` })
    }
  }

  return changes
}

function overlapCount(symbol: AstSymbolInfo, startLine: number, lineCount: number): number {
  const endLine = startLine + Math.max(0, lineCount - 1)
  const overlapStart = Math.max(symbol.startLine, startLine)
  const overlapEnd = Math.min(symbol.endLine, endLine)
  return Math.max(0, overlapEnd - overlapStart + 1)
}

function centerDistance(symbol: AstSymbolInfo, startLine: number, lineCount: number): number {
  const center = startLine + Math.max(0, lineCount - 1) / 2
  const symbolCenter = (symbol.startLine + symbol.endLine) / 2
  return Math.abs(symbolCenter - center)
}

function rankHunkSymbols(astSymbols: AstSymbolInfo[], startLine: number, lineCount: number): AstSymbolInfo[] {
  return astSymbols
    .map((symbol) => ({ symbol, overlap: overlapCount(symbol, startLine, lineCount), distance: centerDistance(symbol, startLine, lineCount) }))
    .filter((entry) => entry.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || a.distance - b.distance || a.symbol.startLine - b.symbol.startLine)
    .map((entry) => entry.symbol)
}

function findAstSymbolsInRange(
  astSymbols: AstSymbolInfo[],
  startLine: number,
  lineCount: number,
  limit = MAX_SYMBOLS_PER_HUNK
): AstSymbolInfo[] {
  return rankHunkSymbols(astSymbols, startLine, lineCount).slice(0, limit)
}

function findOwner(astSymbols: AstSymbolInfo[], startLine: number, lineCount: number): AstSymbolInfo | undefined {
  return rankHunkSymbols(astSymbols, startLine, lineCount)[0]
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

function formatOwner(owner?: AstSymbolInfo): string | undefined {
  return owner ? `${owner.kind}:${owner.name}` : undefined
}

function analyzeHunks(section: FileDiffSection, oldAstSymbols: AstSymbolInfo[], newAstSymbols: AstSymbolInfo[]): AstHunkInsight[] {
  return section.hunks.slice(0, MAX_HUNKS_PER_FILE).map((hunk) => {
    const lines = hunk.body.split('\n').slice(1)
    const addedLines = lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length
    const deletedLines = lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length
    const contextLines = lines.filter((line) => line.startsWith(' ')).length
    const fallbackSymbols = extractSymbols(section.filePath, hunk.body, MAX_SYMBOLS_PER_HUNK)
    const range = parseHunkRange(hunk.header)
    const oldLineCount = Math.max(range.oldLines, 1)
    const newLineCount = Math.max(range.newLines, 1)
    const oldAstSymbolsInHunk = findAstSymbolsInRange(oldAstSymbols, range.oldStart, oldLineCount)
    const newAstSymbolsInHunk = findAstSymbolsInRange(newAstSymbols, range.newStart, newLineCount)
    const astSymbolsInHunk = [...newAstSymbolsInHunk, ...oldAstSymbolsInHunk].filter(
      (symbol, index, array) => array.findIndex((item) => symbolKey(item) === symbolKey(symbol)) === index
    )
    const oldOwner = findOwner(oldAstSymbols, range.oldStart, oldLineCount)
    const newOwner = findOwner(newAstSymbols, range.newStart, newLineCount)
    const owner = newOwner || oldOwner
    const ownerLabel = formatOwner(owner)
    const symbols = astSymbolsInHunk.length ? astSymbolsInHunk.map((symbol) => symbol.name) : fallbackSymbols
    const confidence: NonNullable<AstHunkInsight['confidence']> =
      owner && astSymbolsInHunk.length ? 'high' : owner || astSymbolsInHunk.length ? 'medium' : 'low'
    const summaryParts = [`+${addedLines}`, `-${deletedLines}`, `置信度 ${confidence}`]
    if (ownerLabel) summaryParts.push(`所属 ${ownerLabel}`)
    if (astSymbolsInHunk.length) {
      summaryParts.push(`AST ${astSymbolsInHunk.map((symbol) => `${symbol.kind}:${symbol.name}`).join('、')}`)
    } else if (symbols.length) {
      summaryParts.push(`符号 ${symbols.join('、')}`)
    }
    return {
      header: hunk.header,
      ...range,
      addedLines,
      deletedLines,
      contextLines,
      symbols,
      astSymbols: astSymbolsInHunk,
      oldAstSymbols: oldAstSymbolsInHunk,
      newAstSymbols: newAstSymbolsInHunk,
      owner,
      oldOwner,
      newOwner,
      ownerLabel,
      summary: `${hunk.header}（${summaryParts.join('，')}）`
    }
  })
}

function inferChangeKinds(section: FileDiffSection, symbolChanges: AstSymbolChange[]): string[] {
  const kinds = new Set<string>()
  const diff = section.diff
  if (section.status === 'added') kinds.add('新增文件')
  if (section.status === 'deleted') kinds.add('删除文件')
  if (section.status === 'renamed') kinds.add('重命名')
  if (symbolChanges.some((change) => change.kind === 'added-symbol')) kinds.add('新增符号')
  if (symbolChanges.some((change) => change.kind === 'deleted-symbol')) kinds.add('删除符号')
  if (symbolChanges.some((change) => change.kind === 'modified-body')) kinds.add('函数体/结构变更')
  if (symbolChanges.some((change) => change.kind === 'modified-params')) kinds.add('参数变更')
  if (symbolChanges.some((change) => change.kind === 'modified-return-type')) kinds.add('返回类型变更')
  if (symbolChanges.some((change) => change.kind === 'modified-fields')) kinds.add('字段变更')
  if (/^[+]\s*(?:export\s+)?(?:abstract\s+)?class\s+/m.test(diff)) kinds.add('类变更')
  if (/^[+]\s*<(?:[A-Z][\w.]*|[a-z][\w-]*)/m.test(diff) || /\.tsx$|\.jsx$/i.test(section.filePath)) kinds.add('UI 组件')
  if (/^[+]\s*(?:it|test|describe)\s*\(/m.test(diff) || /(?:test|spec)\.[tj]sx?$/i.test(section.filePath)) kinds.add('测试')
  if (/^[+]\s*(?:import|from)\s+/m.test(diff) || /^[-]\s*(?:import|from)\s+/m.test(diff)) kinds.add('依赖调整')
  if (section.hunks.length > 1) kinds.add('多处 Hunk')
  if (kinds.size === 0) kinds.add('内容调整')
  return [...kinds]
}

function resolveContentPair(section: FileDiffSection, contentMap?: AstFileContentMap): Required<AstFileContentPair> {
  const exact = contentMap?.[section.filePath]
  const oldExact = section.oldPath ? contentMap?.[section.oldPath] : undefined
  return {
    oldContent: exact?.oldContent ?? oldExact?.oldContent ?? buildApproximateSourceFromDiff(section, 'old'),
    newContent: exact?.newContent ?? oldExact?.newContent ?? buildApproximateSourceFromDiff(section, 'new')
  }
}

export function analyzeAstChanges(files: string[], diff: string, contentMap?: AstFileContentMap): AstChangeInsight[] {
  const fileSet = new Set(files)
  const sections = parseFileDiffs(diff).filter(
    (section) => fileSet.size === 0 || fileSet.has(section.filePath) || Boolean(section.oldPath && fileSet.has(section.oldPath))
  )

  return sections.slice(0, MAX_INSIGHTS).map((section) => {
    const language = detectLanguage(section.filePath)
    const { oldContent, newContent } = resolveContentPair(section, contentMap)
    const oldAstSymbols = extractAstSymbols(section.oldPath || section.filePath, section.status === 'added' ? '' : oldContent)
    const newAstSymbols = extractAstSymbols(section.filePath, section.status === 'deleted' ? '' : newContent)
    const astSymbols = (section.status === 'deleted' ? oldAstSymbols : newAstSymbols).slice(0, MAX_SYMBOLS_PER_FILE)
    const symbolChanges = diffAstSymbols(oldAstSymbols, newAstSymbols)
    const fallbackSymbols = extractSymbols(section.filePath, section.diff)
    const symbols = symbolChanges.length
      ? [...new Set(symbolChanges.map((change) => change.symbol.name))].slice(0, MAX_SYMBOLS_PER_FILE)
      : astSymbols.length
        ? astSymbols.map((symbol) => symbol.name)
        : fallbackSymbols
    const changeKinds = inferChangeKinds(section, symbolChanges)
    const hunkInsights = analyzeHunks(section, oldAstSymbols, newAstSymbols)
    const hunks = hunkInsights.map((hunk) => `${section.filePath}@@${hunk.header}`)
    const symbolText = symbols.length ? `，涉及 ${symbols.join('、')}` : ''
    const hunkText = hunkInsights.length ? `，${hunkInsights.length} 个 Hunk` : ''
    const hasAstSignal = symbolChanges.length > 0 || astSymbols.length > 0
    const hasHunkSignal = hunkInsights.length > 0
    const confidence = hasAstSignal && hasHunkSignal
      ? 'high'
      : hasAstSignal || hasHunkSignal
        ? 'medium'
        : 'low'
    const summary = `${section.filePath}：${changeKinds.join('、')}${symbolText}${hunkText}（置信度 ${confidence}）`
    return {
      filePath: section.filePath,
      oldPath: section.oldPath,
      language,
      status: section.status,
      changeKinds,
      symbols,
      astSymbols,
      oldAstSymbols: oldAstSymbols.slice(0, MAX_SYMBOLS_PER_FILE),
      newAstSymbols: newAstSymbols.slice(0, MAX_SYMBOLS_PER_FILE),
      symbolChanges: symbolChanges.slice(0, MAX_SYMBOLS_PER_FILE),
      hunks,
      hunkInsights,
      summary,
      confidence
    }
  })
}

function uniqueByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = getKey(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function extractTypeNames(text?: string): string[] {
  if (!text) return []
  return Array.from(text.matchAll(/\b[A-Z][A-Za-z0-9_$]*/g)).map((match) => match[0])
}

export function detectSemanticConflictRisks(
  oursFiles: string[],
  oursDiff: string,
  theirsFiles: string[],
  theirsDiff: string,
  oursContentMap?: AstFileContentMap,
  theirsContentMap?: AstFileContentMap
): SemanticConflictRisk[] {
  const oursInsights = analyzeAstChanges(oursFiles, oursDiff, oursContentMap)
  const theirsInsights = analyzeAstChanges(theirsFiles, theirsDiff, theirsContentMap)
  const risks: SemanticConflictRisk[] = []

  const oursDeleted = oursInsights.flatMap((insight) =>
    insight.symbolChanges.filter((change) => change.kind === 'deleted-symbol').map((change) => ({ insight, change }))
  )
  const theirsAdded = theirsInsights.flatMap((insight) =>
    insight.symbolChanges.filter((change) => change.kind === 'added-symbol').map((change) => ({ insight, change }))
  )

  for (const deleted of oursDeleted) {
    const match = theirsAdded.find((item) => item.change.symbol.name === deleted.change.symbol.name)
    if (match) {
      risks.push({
        level: 'high',
        type: '调用-删除冲突',
        description: `${deleted.change.symbol.kind}:${deleted.change.symbol.name} 在一侧被删除，但另一侧仍存在新增/调用相关修改。`,
        files: uniqueByKey([deleted.insight.filePath, match.insight.filePath], (item) => item),
        symbols: [deleted.change.symbol.name],
        evidence: [deleted.change.summary, match.change.summary]
      })
    }
  }

  const oursSignatureChanges = oursInsights.flatMap((insight) =>
    insight.symbolChanges
      .filter((change) => change.kind === 'modified-params' || change.kind === 'modified-return-type')
      .map((change) => ({ insight, change }))
  )

  for (const symbol of oursSignatureChanges) {
    const match = theirsAdded.find((item) => item.change.symbol.name === symbol.change.symbol.name)
    if (match) {
      risks.push({
        level: 'medium',
        type: '签名变更冲突',
        description: `${symbol.change.symbol.kind}:${symbol.change.symbol.name} 的签名发生变化，需检查另一侧调用点是否仍匹配。`,
        files: uniqueByKey([symbol.insight.filePath, match.insight.filePath], (item) => item),
        symbols: [symbol.change.symbol.name],
        evidence: [symbol.change.summary, match.change.summary]
      })
    }
  }

  for (const ours of oursInsights) {
    const theirs = theirsInsights.find(
      (item) =>
        item.filePath === ours.filePath &&
        item.symbolChanges.some((change) => change.kind === 'modified-body') &&
        ours.symbolChanges.some((change) => change.kind === 'modified-body')
    )
    if (theirs) {
      risks.push({
        level: 'medium',
        type: '语义覆盖冲突',
        description: `文件 ${ours.filePath} 的核心逻辑在双方都发生了修改，建议人工审查合并语义。`,
        files: [ours.filePath],
        symbols: ours.symbols.slice(0, 3),
        evidence: [ours.summary, theirs.summary]
      })
    }
  }

  for (const insight of [...oursInsights, ...theirsInsights]) {
    for (const change of insight.symbolChanges) {
      if (change.kind === 'modified-fields') {
        const typeNames = extractTypeNames(change.symbol.fields?.join(' ') || change.symbol.signature)
        if (typeNames.length > 0) {
          risks.push({
            level: 'medium',
            type: '类型不兼容冲突',
            description: `类型/接口 ${change.symbol.name} 的字段发生变化，可能影响另一侧实现或调用。`,
            files: [insight.filePath],
            symbols: [change.symbol.name, ...typeNames.slice(0, 2)],
            evidence: [change.summary]
          })
        }
      }
    }
  }

  return uniqueByKey(risks, (risk) => `${risk.type}:${risk.files.join('|')}:${risk.symbols.join('|')}`)
}

export function renderAstContext(files: string[], diff: string, contentMap?: AstFileContentMap): string | undefined {
  if (!diff.trim()) return undefined
  const insights = analyzeAstChanges(files, diff, contentMap)
  if (!insights.length) return undefined

  return insights
    .map((insight) => {
      const symbolText = insight.symbols.length ? insight.symbols.join(', ') : '无明确符号'
      const astText = insight.astSymbols.length
        ? insight.astSymbols.map((symbol) => `${symbol.kind}:${symbol.name}@${symbol.startLine}-${symbol.endLine}`).join(', ')
        : '未解析到 AST 符号'
      const changeText = insight.symbolChanges.length
        ? insight.symbolChanges.map((change) => change.summary).join(', ')
        : '未识别到 AST 级符号差异'
      const hunkText = insight.hunkInsights.length
        ? insight.hunkInsights.map((hunk) => hunk.summary).join(' | ')
        : '无明确 Hunk'
      return `- [${insight.language}/${insight.status}] ${insight.summary}\n  变更类型：${insight.changeKinds.join(', ')}\n  关注符号：${symbolText}\n  AST 符号：${astText}\n  AST Diff：${changeText}\n  Hunk 摘要：${hunkText}`
    })
    .join('\n')
}
