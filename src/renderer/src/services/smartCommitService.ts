import type { AgentResult } from '../agent'
import { invokeGit } from '../api/gitClient'
import { useGitStatusStore } from '../store/gitStatusStore'
import { withOperation } from '../store/operationStore'
import { useUiStore } from '../store/uiStore'
import {
  smartCommitProvider,
  type CommitIntentGroup,
  type SmartCommitAnalysisResult
} from './smartCommitProvider'
import {
  analyzeAstChanges,
  detectSemanticConflictRisks,
  renderAstContext,
  type AstChangeInsight,
  type AstFileContentMap,
  type SemanticConflictRisk
} from '../utils/astChangeAnalyzer'
import { isStagedFile } from '../utils/fileStatus'

export type { CommitIntentGroup, SmartCommitAnalysisResult }
export type { SemanticConflictRisk }

export interface SmartCommitGroupWorkflowResult {
  group: CommitIntentGroup
  message: string
  fallback?: boolean
  fallbackReason?: string
}

function normalizeFiles(files: string[]): string[] {
  return [...new Set(files.map((file) => file.trim()).filter(Boolean))]
}

function combineDiffs(...diffs: string[]): string {
  const parts = diffs.map((diff) => diff.trimEnd()).filter((diff) => diff.trim().length > 0)
  return parts.length > 0 ? `${parts.join('\n')}\n` : ''
}

function buildGroupContext(group: CommitIntentGroup): string {
  const scope = group.scope ? `\n作用域：${group.scope}` : ''
  const confidence = group.confidence ? `\n置信度：${group.confidence}` : ''
  const hunkText = group.hunks?.length ? `\n关联 Hunk：\n${group.hunks.map((hunk) => `- ${hunk}`).join('\n')}` : ''
  return `提交意图：${group.type}${scope}${confidence}\n分组摘要：${group.summary}\n分组文件：\n${group.files.map((file) => `- ${file}`).join('\n')}${hunkText}`
}

interface RawHunk {
  filePath: string
  header: string
  patch: string
}

function normalizeHunkKey(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function parseGroupHunkKey(value: string): { filePath?: string; header: string } {
  const marker = '@@'
  const markerIndex = value.indexOf(marker)
  if (markerIndex <= 0) return { header: normalizeHunkKey(value) }
  const filePath = value.slice(0, markerIndex)
  const header = value.slice(markerIndex)
  return { filePath, header: normalizeHunkKey(header) }
}

function parseRawDiffHunks(diff: string): RawHunk[] {
  const hunks: RawHunk[] = []
  const fileChunks = diff.split(/^diff --git /m).filter(Boolean)

  for (const fileChunk of fileChunks) {
    const lines = fileChunk.split('\n')
    const header = lines[0] || ''
    const pathMatch = header.match(/a\/(.+?)\s+b\/(.+?)$/)
    const filePath = pathMatch?.[2] || pathMatch?.[1]
    if (!filePath) continue

    const fileHeader: string[] = [`diff --git ${header}`]
    let index = 1
    while (index < lines.length && !lines[index].startsWith('@@')) {
      fileHeader.push(lines[index])
      index++
    }

    while (index < lines.length) {
      const hunkStart = index
      const hunkHeader = lines[index]
      if (!hunkHeader.startsWith('@@')) {
        index++
        continue
      }
      index++
      while (index < lines.length && !lines[index].startsWith('@@')) index++
      const hunkLines = lines.slice(hunkStart, index)
      hunks.push({
        filePath,
        header: hunkHeader,
        patch: [...fileHeader, ...hunkLines, ''].join('\n')
      })
    }
  }

  return hunks
}

function matchGroupHunks(group: CommitIntentGroup, diff: string): RawHunk[] {
  const files = new Set(normalizeFiles(group.files))
  const wantedHunks = (group.hunks || []).map(parseGroupHunkKey)
  const rawHunks = parseRawDiffHunks(diff)

  if (wantedHunks.length === 0) {
    return rawHunks.filter((hunk) => files.has(hunk.filePath))
  }

  return rawHunks.filter((hunk) => {
    if (!files.has(hunk.filePath)) return false
    const normalizedHeader = normalizeHunkKey(hunk.header)
    return wantedHunks.some((wanted) => {
      if (wanted.filePath && wanted.filePath !== hunk.filePath) return false
      return wanted.header === normalizedHeader || normalizedHeader.includes(wanted.header) || wanted.header.includes(normalizedHeader)
    })
  })
}

async function applyGroupHunks(group: CommitIntentGroup, diff: string): Promise<string | null> {
  if (!group.hunks?.length) return null
  const hunks = matchGroupHunks(group, diff)
  if (hunks.length === 0) return null

  const patch = hunks.map((hunk) => hunk.patch).join('\n')
  await invokeGit('staging.applyPatch', { patch })
  return patch
}

function getChangedFiles(): string[] {
  return normalizeFiles(useGitStatusStore.getState().fileStatuses.map((file) => file.path))
}

function getStagedFileCount(): number {
  return useGitStatusStore.getState().fileStatuses.filter(isStagedFile).length
}

function getStagedFiles(): string[] {
  return normalizeFiles(useGitStatusStore.getState().fileStatuses.filter(isStagedFile).map((file) => file.path))
}

async function unstageCurrentFiles(): Promise<void> {
  await useGitStatusStore.getState().refreshStatus()
  const stagedFiles = getStagedFiles()

  for (const filePath of stagedFiles) {
    await invokeGit('staging.remove', { path: filePath })
  }

  if (stagedFiles.length > 0) {
    await useGitStatusStore.getState().refreshStatus()
  }
}

type Confidence = NonNullable<AstChangeInsight['confidence']>

const CONFIDENCE_SCORE: Record<Confidence, number> = {
  low: 1,
  medium: 2,
  high: 3
}

function mergeConfidence(values: Array<Confidence | undefined>): Confidence {
  const score = Math.max(1, ...values.map((value) => CONFIDENCE_SCORE[value || 'low']))
  return score >= 3 ? 'high' : score >= 2 ? 'medium' : 'low'
}

function buildHunkAstContext(insights: AstChangeInsight[]): string | undefined {
  const lines = insights.flatMap((insight) =>
    insight.hunkInsights.map((hunk) => {
      const owner = hunk.ownerLabel ? `在 ${hunk.ownerLabel} 内` : '无明确 owner'
      const symbols = hunk.symbols.length ? hunk.symbols.join('、') : '无明确符号'
      return `- ${insight.filePath}@@${hunk.header}：${owner}，+${hunk.addedLines}/-${hunk.deletedLines}，符号：${symbols}，类型：${insight.changeKinds.join('、')}`
    })
  )
  return lines.length ? lines.join('\n') : undefined
}

function buildAnalysisSummary(insights: AstChangeInsight[]): Pick<SmartCommitAnalysisResult, 'analysisSummary' | 'confidence' | 'changeKinds'> {
  const changeKinds = [...new Set(insights.flatMap((insight) => insight.changeKinds))].slice(0, 6)
  const confidence = mergeConfidence(insights.map((insight) => insight.confidence))
  const files = insights.length
  return {
    analysisSummary: files > 0 ? `识别到 ${files} 个文件的 ${changeKinds.slice(0, 3).join('、') || '代码'} 变更` : '已完成智能分组分析',
    confidence,
    changeKinds
  }
}

function enrichGroupsWithAst(
  result: SmartCommitAnalysisResult,
  insights: AstChangeInsight[],
  semanticRisks: SemanticConflictRisk[]
): SmartCommitAnalysisResult {
  const insightMap = new Map(insights.map((insight) => [insight.filePath, insight]))
  const fallback = buildAnalysisSummary(insights)
  const groups = result.groups.map((group) => {
    const groupInsights = group.files.map((file) => insightMap.get(file)).filter((insight): insight is AstChangeInsight => Boolean(insight))
    return {
      ...group,
      confidence: group.confidence || mergeConfidence(groupInsights.map((insight) => insight.confidence))
    }
  })

  return {
    ...result,
    groups,
    semanticRisks: result.semanticRisks?.length ? result.semanticRisks : semanticRisks,
    analysisSummary: result.analysisSummary || fallback.analysisSummary,
    confidence: result.confidence || fallback.confidence,
    changeKinds: result.changeKinds?.length ? result.changeKinds : fallback.changeKinds
  }
}

type DiffFileStatus = 'added' | 'deleted' | 'modified' | 'renamed'

function parseDiffFilePaths(diff: string): Array<{ oldPath?: string; filePath: string; status: DiffFileStatus }> {
  return diff
    .split(/^diff --git /m)
    .filter(Boolean)
    .map((chunk) => {
      const header = chunk.split('\n')[0] || ''
      const pathMatch = header.match(/a\/(.+?)\s+b\/(.+?)$/)
      const oldPath = pathMatch?.[1]
      const filePath = pathMatch?.[2] || oldPath || ''
      const sectionDiff = `diff --git ${chunk}`
      let status: DiffFileStatus = 'modified'

      if (/new file mode|--- \/dev\/null/m.test(sectionDiff)) {
        status = 'added'
      } else if (/deleted file mode|\+\+\+ \/dev\/null/m.test(sectionDiff)) {
        status = 'deleted'
      } else if (/rename from|rename to/m.test(sectionDiff) || Boolean(oldPath && oldPath !== filePath)) {
        status = 'renamed'
      }

      return { oldPath, filePath, status }
    })
    .filter((file) => file.filePath)
}

async function readGitText(path: string, hash = 'HEAD'): Promise<string> {
  try {
    const result = await invokeGit('diff.fileContent', { hash, path })
    return result.content
  } catch {
    return ''
  }
}

function extractFilePatch(diff: string, filePath: string): string {
  const chunk = diff
    .split(/^diff --git /m)
    .filter(Boolean)
    .find((part) => {
      const header = part.split('\n')[0] || ''
      const pathMatch = header.match(/a\/(.+?)\s+b\/(.+?)$/)
      return pathMatch?.[1] === filePath || pathMatch?.[2] === filePath
    })
  return chunk ? `diff --git ${chunk}` : ''
}

function applyUnifiedPatchToContent(oldContent: string, filePatch: string): string {
  const oldLines = oldContent.split('\n')
  const result: string[] = []
  let oldIndex = 0
  const lines = filePatch.split('\n')
  let index = 0

  while (index < lines.length) {
    const header = lines[index]
    const range = header.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
    if (!range) {
      index++
      continue
    }

    const oldStart = Math.max(0, Number(range[1]) - 1)
    while (oldIndex < oldStart && oldIndex < oldLines.length) {
      result.push(oldLines[oldIndex])
      oldIndex++
    }

    index++
    while (index < lines.length && !lines[index].startsWith('@@')) {
      const line = lines[index]
      if (line.startsWith(' ')) {
        result.push(line.slice(1))
        oldIndex++
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        oldIndex++
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        result.push(line.slice(1))
      }
      index++
    }
  }

  while (oldIndex < oldLines.length) {
    result.push(oldLines[oldIndex])
    oldIndex++
  }
  return result.join('\n')
}

async function buildAstContentMap(diff: string): Promise<AstFileContentMap> {
  const entries = parseDiffFilePaths(diff)
  const pairs = await Promise.all(
    entries.map(async (entry) => {
      const oldPath = entry.oldPath || entry.filePath
      const oldContent = entry.status === 'added' ? '' : await readGitText(oldPath)
      const filePatch = extractFilePatch(diff, entry.filePath)
      const newContent = entry.status === 'deleted' ? '' : applyUnifiedPatchToContent(oldContent, filePatch)
      return [entry.filePath, { oldContent, newContent }] as const
    })
  )

  return Object.fromEntries(pairs)
}

/**
 * 智能提交分析入口：读取当前 diff，并交给 SmartCommitProvider 进行意图分组。
 * Provider 内部会优先使用 AI；未配置或调用失败时自动使用本地 fallback，保证流程闭环可用。
 */
export async function analyzeSmartCommitChanges(): Promise<AgentResult<SmartCommitAnalysisResult>> {
  const [workdirDiff, stagedDiff] = await Promise.all([
    invokeGit('diff.workdirRaw', {}),
    invokeGit('diff.stagedRaw', {})
  ])

  const diff = combineDiffs(workdirDiff.diff, stagedDiff.diff)
  const files = getChangedFiles()
  const astContentMap = await buildAstContentMap(diff)
  const astInsights = await analyzeAstChanges(files, diff, astContentMap)
  const semanticRisks = await detectSemanticConflictRisks(files, diff, files, diff, astContentMap, astContentMap)
  const astContext = [await renderAstContext(files, diff, astContentMap), buildHunkAstContext(astInsights)]
    .filter(Boolean)
    .join('\n\nHunk 级上下文：\n')

  if (!diff.trim()) {
    return {
      success: false,
      error: '当前没有可分析的代码变更'
    }
  }

  const result = await smartCommitProvider.analyzeChanges({ diff, files, astContext })
  if (result.success && result.data) {
    return {
      ...result,
      data: enrichGroupsWithAst(result.data, astInsights, semanticRisks)
    }
  }
  return result
}

/**
 * Commit 信息生成入口：基于暂存区 diff 生成 Conventional Commits 提交信息。
 * 若暂存区为空，会自动暂存全部变更，以保证按钮点击后能形成“分析 -> 生成 -> 填入”的最小闭环。
 */
export async function generateSmartCommitMessage(): Promise<AgentResult<string>> {
  return withOperation('commit.generateMessage', async () => {
    try {
      let stagedDiff = await invokeGit('diff.stagedRaw', {})

      // 第一版以快速完成 AI Commit 链路为目标：无暂存内容时自动暂存全部变更。
      if (!stagedDiff.diff.trim()) {
        await invokeGit('staging.addAll')
        await useGitStatusStore.getState().refreshStatus()
        stagedDiff = await invokeGit('diff.stagedRaw', {})
      }

      if (!stagedDiff.diff.trim()) {
        return { success: false, error: '当前没有可用于生成提交信息的暂存变更' }
      }

      const astContentMap = await buildAstContentMap(stagedDiff.diff)
      const astFiles = useGitStatusStore.getState().fileStatuses.map((file) => file.path)
      const astContext = await renderAstContext(astFiles, stagedDiff.diff, astContentMap)
      const semanticRisks = await detectSemanticConflictRisks(astFiles, stagedDiff.diff, astFiles, stagedDiff.diff, astContentMap, astContentMap)
      return smartCommitProvider.generateMessage({
        diff: stagedDiff.diff,
        stagedFileCount: getStagedFileCount(),
        astContext,
        semanticRisks
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useUiStore.getState().setError(`生成提交信息失败: ${message}`)
      return { success: false, error: message }
    }
  })
}

/**
 * 按用户选择的意图分组暂存变更，并只基于该分组的 diff 生成提交信息。
 * 优先使用 hunk 级 patch 暂存，无法匹配 hunk 时回退到文件级暂存，避免阻塞工作流。
 */
export async function stageGroupAndGenerateMessage(
  group: CommitIntentGroup
): Promise<AgentResult<SmartCommitGroupWorkflowResult>> {
  return withOperation('commit.generateMessage', async () => {
    try {
      const files = normalizeFiles(group.files)
      if (files.length === 0) return { success: false, error: '该分组没有可暂存的文件' }

      await unstageCurrentFiles()

      const workdirDiffParts = await Promise.all(
        files.map(async (filePath) => {
          const result = await invokeGit('diff.workdirRaw', { path: filePath })
          return result.diff
        })
      )
      const workdirGroupDiff = workdirDiffParts.filter(Boolean).join('\n')
      const appliedPatch = workdirGroupDiff.trim() ? await applyGroupHunks(group, workdirGroupDiff) : null

      if (!appliedPatch) {
        if (group.hunks?.length) {
          return { success: false, error: '未能匹配该分组的 hunk，已取消暂存以避免误暂存整个文件' }
        }
        for (const filePath of files) {
          await invokeGit('staging.add', { path: filePath })
        }
      }
      await useGitStatusStore.getState().refreshStatus()

      const groupDiffParts = await Promise.all(
        files.map(async (filePath) => {
          const result = await invokeGit('diff.stagedRaw', { path: filePath })
          return result.diff
        })
      )
      const stagedGroupDiff = groupDiffParts.filter(Boolean).join('\n')
      const groupDiff = appliedPatch || stagedGroupDiff

      if (!groupDiff.trim()) {
        return { success: false, error: '该分组暂存后没有可用于生成提交信息的 diff' }
      }

      const astContentMap = await buildAstContentMap(groupDiff)
      const result = await smartCommitProvider.generateMessage({
        diff: groupDiff,
        stagedFileCount: files.length,
        groupContext: buildGroupContext(group),
        astContext: await renderAstContext(files, groupDiff, astContentMap)
      })

      if (!result.success || !result.data) {
        return {
          success: false,
          error: result.error,
          fallback: result.fallback,
          rawOutput: result.rawOutput
        }
      }

      return {
        ...result,
        data: {
          group,
          message: result.data,
          fallback: result.fallback,
          fallbackReason: result.fallback ? result.error : undefined
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      useUiStore.getState().setError(`按分组生成提交信息失败: ${message}`)
      return { success: false, error: message }
    }
  })
}
