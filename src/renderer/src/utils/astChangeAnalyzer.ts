import { Parser, Language, Tree } from 'web-tree-sitter'
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
  parentName?: string
  ownerLabel?: string
}

export interface AstSymbolChange {
  kind:
    | 'added-symbol'
    | 'deleted-symbol'
    | 'modified-body'
    | 'modified-params'
    | 'modified-return-type'
    | 'modified-fields'
    | 'deleted-fields'
  symbol: AstSymbolInfo
  oldSymbol?: AstSymbolInfo
  newSymbol?: AstSymbolInfo
  deletedFields?: string[]
  addedFields?: string[]
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
  language: 'typescript' | 'javascript' | 'tsx' | 'jsx' | 'python' | 'go' | 'java' | 'c' | 'cpp' | 'json' | 'other'
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

const TREE_SITTER_LANGUAGES = new Set<AstChangeInsight['language']>(['python', 'go', 'java', 'c', 'cpp'])

const TREE_SITTER_WASM_BY_LANGUAGE: Partial<Record<AstChangeInsight['language'], string[]>> = {
  python: ['/tree-sitter-python.wasm', '/assets/tree-sitter-python.wasm'],
  go: ['/tree-sitter-go.wasm', '/assets/tree-sitter-go.wasm'],
  java: ['/tree-sitter-java.wasm', '/assets/tree-sitter-java.wasm'],
  c: ['/tree-sitter-c.wasm', '/assets/tree-sitter-c.wasm'],
  cpp: ['/tree-sitter-cpp.wasm', '/assets/tree-sitter-cpp.wasm']
}

const TREE_SITTER_LANGUAGE_NAME: Partial<Record<AstChangeInsight['language'], string>> = {
  python: 'python',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp'
}

export class TreeSitterParser {
  private static initialized = false
  private static parserCache = new Map<string, Parser>()
  private static languageCache = new Map<string, Language>()
  private static initPromise: Promise<void> | null = null

  private async ensureReady(): Promise<void> {
    if (TreeSitterParser.initialized) return
    if (!TreeSitterParser.initPromise) {
      TreeSitterParser.initPromise = Parser.init().then(() => {
        TreeSitterParser.initialized = true
      })
    }
    await TreeSitterParser.initPromise
  }

  private async readWasmBytes(paths: string[]): Promise<Uint8Array | null> {
    for (const path of paths) {
      try {
        const response = await fetch(path)
        if (!response.ok) continue
        return new Uint8Array(await response.arrayBuffer())
      } catch {
        continue
      }
    }
    return null
  }

  private async loadLanguage(language: AstChangeInsight['language']): Promise<Language | null> {
    const languageName = TREE_SITTER_LANGUAGE_NAME[language]
    const wasmPaths = TREE_SITTER_WASM_BY_LANGUAGE[language]
    if (!languageName || !wasmPaths) return null

    const cached = TreeSitterParser.languageCache.get(languageName)
    if (cached) return cached

    const wasmBytes = await this.readWasmBytes(wasmPaths)
    if (!wasmBytes) return null
    const languageModule = await Language.load(wasmBytes)
    TreeSitterParser.languageCache.set(languageName, languageModule)
    return languageModule
  }

  async parse(sourceCode: string, language: AstChangeInsight['language']): Promise<Tree | null> {
    if (!sourceCode.trim()) return null
    await this.ensureReady()
    const parser = TreeSitterParser.parserCache.get(language) || new Parser()
    TreeSitterParser.parserCache.set(language, parser)
    const lang = await this.loadLanguage(language)
    if (!lang) return null
    parser.setLanguage(lang)
    return parser.parse(sourceCode)
  }
}

function detectLanguage(filePath: string): AstChangeInsight['language'] {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.tsx')) return 'tsx'
  if (lower.endsWith('.ts')) return 'typescript'
  if (lower.endsWith('.jsx')) return 'jsx'
  if (lower.endsWith('.js')) return 'javascript'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.go')) return 'go'
  if (lower.endsWith('.java')) return 'java'
  if (lower.endsWith('.c') || lower.endsWith('.h')) return 'c'
  if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx') || lower.endsWith('.hpp') || lower.endsWith('.hh')) return 'cpp'
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

function stableSymbolKey(symbol: AstSymbolInfo): string {
  return `${symbol.kind}:${symbol.ownerLabel || symbol.name}`
}

function displaySymbolName(symbol: AstSymbolInfo): string {
  return symbol.ownerLabel || symbol.name
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
  const ownerLabel = details.ownerLabel || (details.parentName ? `${details.parentName}.${name}` : name)
  const key = buildSymbolKey(ownerLabel, kind, range, details.signature)
  symbols.push({ name, kind, ...range, ...details, ownerLabel, key })
}

function isRangeInside(inner: Pick<AstSymbolInfo, 'startLine' | 'endLine'>, outer: Pick<AstSymbolInfo, 'startLine' | 'endLine'>): boolean {
  return inner.startLine >= outer.startLine && inner.endLine <= outer.endLine
}

function refineNestedOwnerLabels(symbols: AstSymbolInfo[]): AstSymbolInfo[] {
  return symbols.map((symbol) => {
    if (symbol.parentName || symbol.ownerLabel?.includes('.')) return symbol
    const parent = symbols
      .filter((candidate) => candidate !== symbol && ['class', 'function', 'method', 'component'].includes(candidate.kind) && isRangeInside(symbol, candidate))
      .sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0]
    if (!parent) return symbol
    const ownerLabel = `${displaySymbolName(parent)}.${symbol.name}`
    return {
      ...symbol,
      parentName: displaySymbolName(parent),
      ownerLabel,
      key: buildSymbolKey(ownerLabel, symbol.kind, symbol, symbol.signature)
    }
  })
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

function getObjectKeyName(node: Node | null | undefined): string | undefined {
  if (!node) return undefined
  if (node.type === 'Identifier') return node.name
  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral') return String(node.value)
  return undefined
}

function getNodeDeclaredName(node: Node): string | undefined {
  if (node.type === 'FunctionDeclaration') return node.id?.name
  if (node.type === 'ClassDeclaration') return node.id?.name || 'default'
  if (node.type === 'ClassMethod' || node.type === 'ObjectMethod') return getObjectKeyName(node.key)
  if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') return node.id.name
  if (node.type === 'ObjectProperty') return getObjectKeyName(node.key)
  if (node.type === 'TSModuleDeclaration') return getObjectKeyName(node.id)
  return undefined
}

function getParentOwnerLabel(path: { findParent: (callback: (parentPath: { node: Node }) => boolean) => any }): string | undefined {
  const owners: string[] = []
  const ownerNodes: Node[] = []
  let current = path.findParent((parentPath) => {
    const node = parentPath.node
    return (
      node.type === 'ClassDeclaration' ||
      node.type === 'ClassMethod' ||
      node.type === 'ObjectMethod' ||
      node.type === 'ObjectProperty' ||
      node.type === 'FunctionDeclaration' ||
      node.type === 'VariableDeclarator' ||
      node.type === 'TSModuleDeclaration'
    )
  })

  while (current?.node) {
    ownerNodes.unshift(current.node)
    const currentNode = current.node
    current = current.findParent?.((parentPath) => {
      const node = parentPath.node
      return (
        node !== currentNode &&
        (node.type === 'ClassDeclaration' ||
          node.type === 'ClassMethod' ||
          node.type === 'ObjectMethod' ||
          node.type === 'ObjectProperty' ||
          node.type === 'FunctionDeclaration' ||
          node.type === 'VariableDeclarator' ||
          node.type === 'TSModuleDeclaration')
      )
    }) as typeof current
  }

  for (const node of ownerNodes) {
    const name = getNodeDeclaredName(node)
    if (name && owners[owners.length - 1] !== name) owners.push(name)
  }
  return owners.length ? owners.join('.') : undefined
}

function addTreeSitterSymbol(
  symbols: AstSymbolInfo[],
  name: string | undefined,
  kind: string,
  startLine: number,
  endLine: number,
  signature: string,
  parentName?: string,
  ownerLabel?: string,
  fields?: string[]
): void {
  if (!name) return
  const resolvedOwner = ownerLabel || (parentName ? `${parentName}.${name}` : name)
  symbols.push({
    name,
    kind,
    startLine,
    endLine,
    signature,
    bodyHash: hashText(signature),
    fields,
    confidence: 'medium',
    parentName,
    ownerLabel: resolvedOwner,
    key: `${kind}:${resolvedOwner}:${startLine}-${endLine}`
  })
}

type TreeSitterNode = {
  type: string
  text?: string
  startPosition?: { row: number }
  endPosition?: { row: number }
  namedChildren?: TreeSitterNode[]
  children?: TreeSitterNode[]
  childForFieldName?: (name: string) => TreeSitterNode | null
  parent?: TreeSitterNode | null
}

function nodeLineRange(node: TreeSitterNode): Pick<AstSymbolInfo, 'startLine' | 'endLine'> | undefined {
  const startLine = node.startPosition?.row != null ? node.startPosition.row + 1 : undefined
  const endLine = node.endPosition?.row != null ? node.endPosition.row + 1 : undefined
  if (!startLine || !endLine) return undefined
  return { startLine, endLine }
}

function nodeText(node: TreeSitterNode | null | undefined, source: string): string {
  if (!node) return ''
  return node.text || source.slice(0, 0)
}

function firstIdentifierText(node: TreeSitterNode | null | undefined): string | undefined {
  if (!node) return undefined
  if (node.type === 'identifier' || node.type === 'type_identifier' || node.type === 'field_identifier') return node.text
  for (const child of node.namedChildren || node.children || []) {
    const found = firstIdentifierText(child)
    if (found) return found
  }
  return undefined
}

function collectTreeSitterSymbols(filePath: string, source: string, tree: Tree): AstSymbolInfo[] {
  const language = detectLanguage(filePath)
  const symbols: AstSymbolInfo[] = []
  const visit = (node: TreeSitterNode, ownerStack: string[] = []): void => {
    const range = nodeLineRange(node)
    if (!range) return

    if (language === 'python') {
      if (node.type === 'class_definition') {
        const name = firstIdentifierText(node.childForFieldName?.('name') || null) || firstIdentifierText(node)
        const ownerLabel = ownerStack.length ? `${ownerStack.join('.')}.${name}` : name
        if (name) addTreeSitterSymbol(symbols, name, 'class', range.startLine, range.endLine, nodeText(node, source), undefined, ownerLabel)
        const nextStack = name ? [...ownerStack, name] : ownerStack
        for (const child of node.namedChildren || []) visit(child, nextStack)
        return
      }
      if (node.type === 'function_definition') {
        const name = firstIdentifierText(node.childForFieldName?.('name') || null)
        const owner = ownerStack[ownerStack.length - 1]
        const ownerLabel = owner ? `${owner}.${name}` : name
        if (name) addTreeSitterSymbol(symbols, name, 'function', range.startLine, range.endLine, nodeText(node, source), owner, ownerLabel)
        return
      }
    }

    if (language === 'go') {
      if (node.type === 'type_spec') {
        const name = firstIdentifierText(node.childForFieldName?.('name') || null)
        const typeNode = node.childForFieldName?.('type') || null
        const kind = typeNode?.type === 'struct_type' ? 'struct' : typeNode?.type === 'interface_type' ? 'interface' : undefined
        if (name && kind) addTreeSitterSymbol(symbols, name, kind, range.startLine, range.endLine, nodeText(node, source))
      }
      if (node.type === 'function_declaration') {
        const name = firstIdentifierText(node.childForFieldName?.('name') || null)
        const receiver = node.childForFieldName?.('receiver') || null
        const receiverName = receiver ? firstIdentifierText(receiver) : undefined
        const ownerLabel = receiverName && name ? `${receiverName}.${name}` : name
        if (name) addTreeSitterSymbol(symbols, name, 'function', range.startLine, range.endLine, nodeText(node, source), receiverName, ownerLabel)
      }
    }

    if (language === 'java') {
      if (node.type === 'class_declaration') {
        const name = firstIdentifierText(node.childForFieldName?.('name') || null)
        if (name) addTreeSitterSymbol(symbols, name, 'class', range.startLine, range.endLine, nodeText(node, source))
      }
      if (node.type === 'interface_declaration') {
        const name = firstIdentifierText(node.childForFieldName?.('name') || null)
        if (name) addTreeSitterSymbol(symbols, name, 'interface', range.startLine, range.endLine, nodeText(node, source))
      }
      if (node.type === 'method_declaration') {
        const name = firstIdentifierText(node.childForFieldName?.('name') || null)
        const classAncestor = ownerStack[ownerStack.length - 1]
        const ownerLabel = classAncestor && name ? `${classAncestor}.${name}` : name
        if (name) addTreeSitterSymbol(symbols, name, 'method', range.startLine, range.endLine, nodeText(node, source), classAncestor, ownerLabel)
      }
    }

    if (language === 'c' || language === 'cpp') {
      if (node.type === 'function_definition') {
        const name = firstIdentifierText(node.childForFieldName?.('declarator') || node)
        if (name) addTreeSitterSymbol(symbols, name, 'function', range.startLine, range.endLine, nodeText(node, source))
      }
      if (node.type === 'struct_specifier') {
        const name = firstIdentifierText(node.childForFieldName?.('name') || null)
        if (name) addTreeSitterSymbol(symbols, name, 'struct', range.startLine, range.endLine, nodeText(node, source))
      }
      if (language === 'cpp') {
        if (node.type === 'class_specifier') {
          const name = firstIdentifierText(node.childForFieldName?.('name') || null)
          if (name) addTreeSitterSymbol(symbols, name, 'class', range.startLine, range.endLine, nodeText(node, source))
        }
        if (node.type === 'template_declaration') {
          const inner = (node.namedChildren || []).find((child) => ['function_definition', 'class_specifier', 'struct_specifier'].includes(child.type))
          if (inner) visit(inner, ownerStack)
        }
      }
    }

    for (const child of node.namedChildren || []) visit(child, ownerStack)
  }

  visit(tree.rootNode as unknown as TreeSitterNode)
  return uniqueByKey(symbols, (symbol) => symbolKey(symbol))
}

function extractTreeSitterSymbols(filePath: string, source: string, tree?: Tree | null): AstSymbolInfo[] {
  const language = detectLanguage(filePath)
  if (!TREE_SITTER_LANGUAGES.has(language) || !source.trim()) return []
  if (tree) return collectTreeSitterSymbols(filePath, source, tree)
  return []
}

async function extractTreeSitterAstSymbols(filePath: string, source: string, parser: TreeSitterParser): Promise<AstSymbolInfo[]> {
  const tree = await parser.parse(source, detectLanguage(filePath))
  if (!tree) return []
  return extractTreeSitterSymbols(filePath, source, tree)
}

async function extractAstSymbols(filePath: string, source: string, parser?: TreeSitterParser): Promise<AstSymbolInfo[]> {
  const language = detectLanguage(filePath)
  if (TREE_SITTER_LANGUAGES.has(language)) return parser ? extractTreeSitterAstSymbols(filePath, source, parser) : []
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
        const parentName = getParentOwnerLabel(path)
        pushAstSymbol(symbols, path.node.id?.name, 'function', path.node, {
          ...details,
          parentName,
          ownerLabel: parentName ? `${parentName}.${path.node.id?.name}` : path.node.id?.name,
          confidence: getSymbolConfidence('function', details)
        })
      },
      ClassDeclaration(path) {
        const details = { bodyHash: hashText(codeOf(path.node.body)) }
        const isDefaultExport = path.parent.type === 'ExportDefaultDeclaration'
        const name = path.node.id?.name || (isDefaultExport ? 'default' : undefined)
        pushAstSymbol(symbols, name, 'class', path.node, {
          ...details,
          ownerLabel: isDefaultExport && !path.node.id?.name ? 'default class' : name,
          confidence: getSymbolConfidence('class', details)
        })
      },
      TSModuleDeclaration(path) {
        const name = getObjectKeyName(path.node.id as Node)
        const details = { bodyHash: hashText(codeOf(path.node.body)) }
        pushAstSymbol(symbols, name, 'namespace', path.node, {
          ...details,
          confidence: 'high'
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
        const name = getObjectKeyName(path.node.key as Node)
        const details = {
          params: paramText(path.node.params),
          returnType: returnTypeText(path.node),
          bodyHash: hashText(codeOf(path.node.body)),
          signature: functionSignature(name, path.node.params, returnTypeText(path.node))
        }
        const parentName = getParentOwnerLabel(path)
        pushAstSymbol(symbols, name, 'method', path.node, {
          ...details,
          parentName,
          ownerLabel: parentName && name ? `${parentName}.${name}` : name,
          confidence: getSymbolConfidence('method', details)
        })
      },
      ObjectProperty(path) {
        const name = getObjectKeyName(path.node.key as Node)
        const value = path.node.value as Node
        if (value.type !== 'FunctionExpression' && value.type !== 'ArrowFunctionExpression' && value.type !== 'ObjectExpression') return
        const parentName = getParentOwnerLabel(path)
        const isFunction = value.type === 'FunctionExpression' || value.type === 'ArrowFunctionExpression'
        const details = isFunction
          ? {
              params: paramText(value.params),
              returnType: returnTypeText(value),
              bodyHash: hashText(codeOf(value.body)),
              signature: functionSignature(name, value.params, returnTypeText(value))
            }
          : { bodyHash: hashText(codeOf(value)) }
        const kind = isFunction ? 'method' : 'object'
        pushAstSymbol(symbols, name, kind, path.node, {
          ...details,
          parentName,
          ownerLabel: parentName && name ? `${parentName}.${name}` : name,
          confidence: getSymbolConfidence(kind, details)
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
        const calleeName = memberExpressionName(path.node.callee as Node)
        const helper = calleeName?.split('.').pop()
        if (!helper || !['memo', 'forwardRef'].includes(helper)) return
        const firstArg = path.node.arguments[0]
        if (!firstArg || firstArg.type !== 'ArrowFunctionExpression' && firstArg.type !== 'FunctionExpression') return
        const parentName = getParentOwnerLabel(path)
        const componentName = firstArg.type === 'FunctionExpression' && firstArg.id?.name ? firstArg.id.name : parentName || helper
        const details = {
          params: paramText(firstArg.params),
          returnType: returnTypeText(firstArg),
          bodyHash: hashText(codeOf(firstArg.body)),
          signature: `${helper}(${paramText(firstArg.params)}):${returnTypeText(firstArg)}`
        }
        pushAstSymbol(symbols, componentName, 'component', path.node, {
          ...details,
          parentName,
          ownerLabel: parentName && componentName !== parentName ? `${parentName}.${componentName}` : componentName,
          confidence: firstArg.type === 'FunctionExpression' && firstArg.id?.name ? 'high' : 'medium'
        })
      }
    })

    const seen = new Set<string>()
    return refineNestedOwnerLabels(symbols).filter((symbol) => {
      const key = `${symbol.kind}:${displaySymbolName(symbol)}:${symbol.startLine}:${symbol.endLine}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  } catch {
    return []
  }
}

function symbolKey(symbol: AstSymbolInfo): string {
  return symbol.key || `${symbol.kind}:${displaySymbolName(symbol)}:${symbol.startLine}-${symbol.endLine}:${symbol.signature || ''}`
}

function compareSymbolKey(symbol: AstSymbolInfo): string {
  return stableSymbolKey(symbol)
}

function sameFields(a?: string[], b?: string[]): boolean {
  return JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort())
}

function fieldDiff(oldFields?: string[], newFields?: string[]): { deletedFields: string[]; addedFields: string[] } {
  const oldSet = new Set(oldFields || [])
  const newSet = new Set(newFields || [])
  return {
    deletedFields: [...oldSet].filter((field) => !newSet.has(field)),
    addedFields: [...newSet].filter((field) => !oldSet.has(field))
  }
}

function diffAstSymbols(oldSymbols: AstSymbolInfo[], newSymbols: AstSymbolInfo[]): AstSymbolChange[] {
  const changes: AstSymbolChange[] = []
  const oldMap = new Map(oldSymbols.map((symbol) => [compareSymbolKey(symbol), symbol]))
  const newMap = new Map(newSymbols.map((symbol) => [compareSymbolKey(symbol), symbol]))

  for (const symbol of newSymbols) {
    if (!oldMap.has(compareSymbolKey(symbol))) {
      changes.push({ kind: 'added-symbol', symbol, newSymbol: symbol, summary: `新增 ${symbol.kind}:${displaySymbolName(symbol)}` })
    }
  }

  for (const symbol of oldSymbols) {
    if (!newMap.has(compareSymbolKey(symbol))) {
      changes.push({ kind: 'deleted-symbol', symbol, oldSymbol: symbol, summary: `删除 ${symbol.kind}:${displaySymbolName(symbol)}` })
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
      const { deletedFields, addedFields } = fieldDiff(oldSymbol.fields, newSymbol.fields)
      changes.push({ kind: 'modified-fields', symbol: newSymbol, oldSymbol, newSymbol, deletedFields, addedFields, summary: `修改字段 ${newSymbol.kind}:${newSymbol.name}` })
      if (deletedFields.length) {
        changes.push({
          kind: 'deleted-fields',
          symbol: newSymbol,
          oldSymbol,
          newSymbol,
          deletedFields,
          addedFields,
          summary: `删除字段 ${newSymbol.kind}:${newSymbol.name}.${deletedFields.slice(0, 3).join('、')}`
        })
      }
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
  return owner ? displaySymbolName(owner) : undefined
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
    const symbols = astSymbolsInHunk.length ? astSymbolsInHunk.map((symbol) => displaySymbolName(symbol)) : fallbackSymbols
    const confidence: NonNullable<AstHunkInsight['confidence']> =
      owner && astSymbolsInHunk.length ? 'high' : owner || astSymbolsInHunk.length ? 'medium' : 'low'
    const summaryParts = [`+${addedLines}`, `-${deletedLines}`, `置信度 ${confidence}`]
    if (ownerLabel) summaryParts.push(`所属 ${ownerLabel}`)
    if (astSymbolsInHunk.length) {
      summaryParts.push(`AST ${astSymbolsInHunk.map((symbol) => `${symbol.kind}:${displaySymbolName(symbol)}`).join('、')}`)
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
  if (symbolChanges.some((change) => change.kind === 'deleted-fields')) kinds.add('字段删除')
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

export async function analyzeAstChanges(files: string[], diff: string, contentMap?: AstFileContentMap): Promise<AstChangeInsight[]> {
  const fileSet = new Set(files)
  const sections = parseFileDiffs(diff).filter(
    (section) => fileSet.size === 0 || fileSet.has(section.filePath) || Boolean(section.oldPath && fileSet.has(section.oldPath))
  )

  const treeSitterParser = new TreeSitterParser()
  return Promise.all(sections.slice(0, MAX_INSIGHTS).map(async (section) => {
    const language = detectLanguage(section.filePath)
    const { oldContent, newContent } = resolveContentPair(section, contentMap)
    const oldAstSymbols = await extractAstSymbols(section.oldPath || section.filePath, section.status === 'added' ? '' : oldContent, treeSitterParser)
    const newAstSymbols = await extractAstSymbols(section.filePath, section.status === 'deleted' ? '' : newContent, treeSitterParser)
    const astSymbols = (section.status === 'deleted' ? oldAstSymbols : newAstSymbols).slice(0, MAX_SYMBOLS_PER_FILE)
    const symbolChanges = diffAstSymbols(oldAstSymbols, newAstSymbols)
    const fallbackSymbols = extractSymbols(section.filePath, section.diff)
    const symbols = symbolChanges.length
      ? [...new Set(symbolChanges.map((change) => displaySymbolName(change.symbol)))].slice(0, MAX_SYMBOLS_PER_FILE)
      : astSymbols.length
        ? astSymbols.map((symbol) => displaySymbolName(symbol))
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
  }))
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

function normalizeFieldName(field: string): string {
  return field
    .replace(/^readonly\s+/, '')
    .replace(/[?;].*$/, '')
    .replace(/:.+$/, '')
    .replace(/\(.+$/, '')
    .trim()
}

function extractChangedLineText(diff: string, prefix: '+' | '-'): string {
  return diff
    .split('\n')
    .filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`))
    .map((line) => line.slice(1))
    .join('\n')
}

function getJsAst(filePath: string, source: string): ReturnType<typeof parse> | undefined {
  const language = detectLanguage(filePath)
  if (!JS_LIKE_LANGUAGES.has(language) || !source.trim()) return undefined
  try {
    return parse(source, {
      sourceType: 'unambiguous',
      plugins: getBabelPlugins(language),
      errorRecovery: true
    })
  } catch {
    return undefined
  }
}

function memberExpressionName(node: Node): string | undefined {
  if (node.type === 'Identifier') return node.name
  if (node.type === 'ThisExpression') return 'this'
  if (node.type === 'Super') return 'super'
  if (node.type === 'StringLiteral') return node.value
  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') return undefined
  const object = memberExpressionName(node.object as Node)
  const property = memberExpressionName(node.property as Node)
  if (!object || !property) return object || property
  return `${object}.${property}`
}

function addReferenceWithAliases(refs: Set<string>, name: string | undefined, aliases: Map<string, string>): void {
  if (!name) return
  const root = name.split('.')[0]
  refs.add(name)
  refs.add(root)
  const aliased = aliases.get(root)
  if (aliased) {
    refs.add(aliased)
    if (name.includes('.')) refs.add(`${aliased}.${name.split('.').slice(1).join('.')}`)
  }
}

function extractBindingAliasesFromPattern(node: Node | null | undefined, aliases: Map<string, string>, sourcePrefix?: string): void {
  if (!node) return
  if (node.type === 'Identifier') {
    if (sourcePrefix) aliases.set(node.name, sourcePrefix)
    return
  }
  if (node.type === 'ObjectPattern') {
    for (const property of node.properties) {
      if (property.type === 'RestElement') {
        extractBindingAliasesFromPattern(property.argument as Node, aliases, sourcePrefix)
        continue
      }
      const key = property.key as Node
      const value = property.value as Node
      const keyName = memberExpressionName(key)
      const nextPrefix = sourcePrefix && keyName ? `${sourcePrefix}.${keyName}` : keyName
      extractBindingAliasesFromPattern(value, aliases, nextPrefix)
    }
  }
}

function extractBabelCallReferences(filePath: string, source: string): string[] {
  const ast = getJsAst(filePath, source)
  if (!ast) return []
  const refs = new Set<string>()
  const aliases = new Map<string, string>()

  traverse(ast, {
    ImportDeclaration(path) {
      const sourceName = path.node.source.value
      for (const specifier of path.node.specifiers) {
        if (specifier.type === 'ImportSpecifier') {
          const imported = specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value
          aliases.set(specifier.local.name, imported)
          aliases.set(`${sourceName}:${specifier.local.name}`, imported)
        } else if (specifier.type === 'ImportDefaultSpecifier') {
          aliases.set(specifier.local.name, 'default')
        } else if (specifier.type === 'ImportNamespaceSpecifier') {
          aliases.set(specifier.local.name, sourceName)
        }
      }
    },
    VariableDeclarator(path) {
      const initName = path.node.init ? memberExpressionName(path.node.init as Node) : undefined
      extractBindingAliasesFromPattern(path.node.id as Node, aliases, initName)
    },
    CallExpression(path) {
      const callee = path.node.callee as Node
      if (callee.type === 'Import') return
      addReferenceWithAliases(refs, memberExpressionName(callee), aliases)
    },
    OptionalCallExpression(path) {
      addReferenceWithAliases(refs, memberExpressionName(path.node.callee as Node), aliases)
    },
    MemberExpression(path) {
      addReferenceWithAliases(refs, memberExpressionName(path.node as Node), aliases)
    },
    OptionalMemberExpression(path) {
      addReferenceWithAliases(refs, memberExpressionName(path.node as Node), aliases)
    },
    JSXOpeningElement(path) {
      const name = path.node.name
      if (name.type === 'JSXIdentifier') addReferenceWithAliases(refs, name.name, aliases)
      if (name.type === 'JSXMemberExpression') addReferenceWithAliases(refs, codeOf(name as unknown as Node).replace(/\s+/g, ''), aliases)
    }
  })

  return [...refs].filter((name) => !['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'sizeof'].includes(name))
}

function extractRegexCallReferences(text: string): string[] {
  const refs = new Set<string>()
  for (const match of text.matchAll(/(?:\b|\.)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/g)) {
    const name = match[1]
    if (!['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'sizeof'].includes(name)) refs.add(name)
  }
  return [...refs]
}

function extractCallReferences(filePath: string, text: string): string[] {
  const astRefs = extractBabelCallReferences(filePath, text)
  return astRefs.length ? astRefs : extractRegexCallReferences(text)
}

interface HunkSymbolReference {
  insight: AstChangeInsight
  hunk: AstHunkInsight
  refs: string[]
  evidence: string
}

interface DeletedDefinition {
  insight: AstChangeInsight
  hunk?: AstHunkInsight
  symbol: AstSymbolInfo
  summary: string
}

function collectDeletedDefinitions(insights: AstChangeInsight[]): DeletedDefinition[] {
  return insights.flatMap((insight) =>
    insight.symbolChanges
      .filter((change) => change.kind === 'deleted-symbol')
      .map((change) => {
        const hunk = insight.hunkInsights.find((item) => item.oldAstSymbols.some((symbol) => compareSymbolKey(symbol) === compareSymbolKey(change.symbol)))
        return { insight, hunk, symbol: change.symbol, summary: change.summary }
      })
  )
}

function extractHunkChangedLineText(hunk: AstHunkInsight, diffByFile: Map<string, FileDiffSection>, filePath: string, prefix: '+' | '-'): string {
  const section = diffByFile.get(filePath)
  const rawHunk = section?.hunks.find((item) => item.header === hunk.header)
  if (!rawHunk) return ''
  return extractChangedLineText(rawHunk.body, prefix)
}

function collectAddedReferences(diff: string, insights: AstChangeInsight[]): HunkSymbolReference[] {
  const diffByFile = new Map(parseFileDiffs(diff).map((section) => [section.filePath, section]))
  return insights.flatMap((insight) =>
    insight.hunkInsights
      .map((hunk) => {
        const refs = extractCallReferences(insight.filePath, extractHunkChangedLineText(hunk, diffByFile, insight.filePath, '+'))
        return {
          insight,
          hunk,
          refs,
          evidence: hunk.summary
        }
      })
      .filter((item) => item.refs.length > 0)
  )
}

function referenceMatchesDeletedSymbol(ref: string, symbol: AstSymbolInfo): boolean {
  const owner = displaySymbolName(symbol)
  return ref === symbol.name || ref === owner || ref.endsWith(`.${symbol.name}`) || owner.endsWith(`.${ref}`)
}

export async function detectSemanticConflictRisks(
  oursFiles: string[],
  oursDiff: string,
  theirsFiles: string[],
  theirsDiff: string,
  oursContentMap?: AstFileContentMap,
  theirsContentMap?: AstFileContentMap
): Promise<SemanticConflictRisk[]> {
  const oursInsights = await analyzeAstChanges(oursFiles, oursDiff, oursContentMap)
  const theirsInsights = await analyzeAstChanges(theirsFiles, theirsDiff, theirsContentMap)
  const risks: SemanticConflictRisk[] = []

  const oursDeleted = collectDeletedDefinitions(oursInsights)
  const theirsAddedRefs = collectAddedReferences(theirsDiff, theirsInsights)
  const oursAddedRefs = collectAddedReferences(oursDiff, oursInsights)

  for (const deleted of oursDeleted) {
    const match = theirsAddedRefs.find((item) => item.refs.some((ref) => referenceMatchesDeletedSymbol(ref, deleted.symbol)))
    if (match) {
      const matchedRefs = match.refs.filter((ref) => referenceMatchesDeletedSymbol(ref, deleted.symbol))
      risks.push({
        level: 'high',
        type: '调用-删除冲突',
        description: `${deleted.symbol.kind}:${displaySymbolName(deleted.symbol)} 在一侧被删除，但另一侧新增 hunk 仍调用 ${matchedRefs.join('、')}。`,
        files: uniqueByKey([deleted.insight.filePath, match.insight.filePath], (item) => item),
        symbols: [displaySymbolName(deleted.symbol), ...matchedRefs],
        evidence: [deleted.summary, deleted.hunk?.summary || '', `新增调用：${matchedRefs.join('、')}`, match.evidence].filter(Boolean)
      })
    }
  }

  const oursSignatureChanges = oursInsights.flatMap((insight) =>
    insight.symbolChanges
      .filter((change) => change.kind === 'modified-params' || change.kind === 'modified-return-type')
      .map((change) => ({ insight, change }))
  )

  for (const symbol of oursSignatureChanges) {
    const match = theirsAddedRefs.find((item) => item.refs.some((ref) => referenceMatchesDeletedSymbol(ref, symbol.change.symbol)))
    if (match) {
      const matchedRefs = match.refs.filter((ref) => referenceMatchesDeletedSymbol(ref, symbol.change.symbol))
      risks.push({
        level: symbol.change.kind === 'modified-params' ? 'high' : 'medium',
        type: symbol.change.kind === 'modified-params' ? '签名变更冲突' : '类型不兼容冲突',
        description: `${symbol.change.symbol.kind}:${displaySymbolName(symbol.change.symbol)} 的${symbol.change.kind === 'modified-params' ? '参数签名' : '返回类型'}发生变化，另一侧新增 hunk 使用了 ${matchedRefs.join('、')}。`,
        files: uniqueByKey([symbol.insight.filePath, match.insight.filePath], (item) => item),
        symbols: [displaySymbolName(symbol.change.symbol), ...matchedRefs],
        evidence: [symbol.change.summary, `新增引用：${matchedRefs.join('、')}`, match.evidence]
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

  const deletedFieldChanges = oursInsights.flatMap((insight) =>
    insight.symbolChanges.filter((change) => change.kind === 'deleted-fields').map((change) => ({ insight, change }))
  )
  for (const item of deletedFieldChanges) {
    const fields = (item.change.deletedFields || []).map(normalizeFieldName).filter(Boolean)
    if (!fields.length) continue
    const match = theirsAddedRefs.concat(oursAddedRefs).find((refItem) =>
      refItem.refs.some((ref) => fields.some((field) => ref === field || ref.endsWith(`.${field}`)))
    )
    if (match) {
      const matchedRefs = match.refs.filter((ref) => fields.some((field) => ref === field || ref.endsWith(`.${field}`)))
      risks.push({
        level: 'high',
        type: '类型不兼容冲突',
        description: `${displaySymbolName(item.change.symbol)} 删除了字段 ${fields.join('、')}，但新增 hunk 仍访问 ${matchedRefs.join('、')}。`,
        files: uniqueByKey([item.insight.filePath, match.insight.filePath], (file) => file),
        symbols: [displaySymbolName(item.change.symbol), ...fields, ...matchedRefs],
        evidence: [item.change.summary, `新增属性访问：${matchedRefs.join('、')}`, match.evidence]
      })
    }
  }

  return uniqueByKey(risks, (risk) => `${risk.type}:${risk.files.join('|')}:${risk.symbols.join('|')}`)
}

export async function renderAstContext(files: string[], diff: string, contentMap?: AstFileContentMap): Promise<string | undefined> {
  if (!diff.trim()) return undefined
  const insights = await analyzeAstChanges(files, diff, contentMap)
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

export async function buildConflictAnalysisContext(files: string[], diff: string, contentMap?: AstFileContentMap): Promise<string | undefined> {
  const insights = await analyzeAstChanges(files, diff, contentMap)
  if (!insights.length) return undefined

  return insights
    .map((insight) => {
      const topChanges = insight.symbolChanges.slice(0, 3).map((change) => change.summary).join('；') || '无 AST 差异'
      const hunkSummary = insight.hunkInsights.slice(0, 2).map((hunk) => hunk.summary).join(' | ') || '无 Hunk 解析'
      return [
        `文件：${insight.filePath}`,
        `状态：${insight.status}`,
        `风险：${insight.confidence || 'low'}`,
        `符号：${insight.symbols.length ? insight.symbols.join('、') : '无'}`,
        `变化：${insight.changeKinds.join('、')}`,
        `关键差异：${topChanges}`,
        `Hunk：${hunkSummary}`
      ].join('\n')
    })
    .join('\n\n')
}
