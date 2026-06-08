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
import { renderAstContext, type AstFileContentMap } from '../utils/astChangeAnalyzer'

export type { CommitIntentGroup, SmartCommitAnalysisResult }

export interface SmartCommitGroupWorkflowResult {
  group: CommitIntentGroup
  message: string
  fallback?: boolean
  fallbackReason?: string
}

function normalizeFiles(files: string[]): string[] {
  return [...new Set(files.map((file) => file.trim()).filter(Boolean))]
}

function buildGroupContext(group: CommitIntentGroup): string {
  const scope = group.scope ? `\n作用域：${group.scope}` : ''
  const hunkText = group.hunks?.length ? `\n关联 Hunk：\n${group.hunks.map((hunk) => `- ${hunk}`).join('\n')}` : ''
  return `提交意图：${group.type}${scope}\n分组摘要：${group.summary}\n分组文件：\n${group.files.map((file) => `- ${file}`).join('\n')}${hunkText}`
}

interface RawHunk {
  filePath: string
  header: string
  patch: string
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
  const wantedHunks = new Set(group.hunks || [])
  return parseRawDiffHunks(diff).filter((hunk) => {
    if (!files.has(hunk.filePath)) return false
    if (wantedHunks.size === 0) return true
    return wantedHunks.has(`${hunk.filePath}@@${hunk.header}`) || wantedHunks.has(hunk.header)
  })
}

async function applyGroupHunks(group: CommitIntentGroup, diff: string): Promise<string | null> {
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
  return useGitStatusStore
    .getState()
    .fileStatuses.filter((file) => file.staging && file.staging !== 'unmodified').length
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

async function readGitText(path: string, ref: 'HEAD' | 'WORKTREE' | 'INDEX'): Promise<string> {
  try {
    if (ref === 'WORKTREE') {
      return await Promise.resolve('')
    }

    const result = await invokeGit('diff.fileContent', { hash: 'HEAD', path })
    return result.content
  } catch {
    return ''
  }
}

async function buildAstContentMap(diff: string): Promise<AstFileContentMap> {
  const entries = parseDiffFilePaths(diff)
  const pairs = await Promise.all(
    entries.map(async (entry) => {
      const oldPath = entry.oldPath || entry.filePath
      const [oldContent, newContent] = await Promise.all([
        entry.status === 'added' ? Promise.resolve('') : readGitText(oldPath, 'HEAD'),
        Promise.resolve('')
      ])
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

  const diff = workdirDiff.diff || stagedDiff.diff
  const files = getChangedFiles()
  const astContentMap = await buildAstContentMap(diff)
  const astContext = renderAstContext(files, diff, astContentMap)

  if (!diff.trim()) {
    return {
      success: false,
      error: '当前没有可分析的代码变更'
    }
  }

  return smartCommitProvider.analyzeChanges({ diff, files, astContext })
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
      const astContext = renderAstContext(
        useGitStatusStore.getState().fileStatuses.map((file) => file.path),
        stagedDiff.diff,
        astContentMap
      )
      return smartCommitProvider.generateMessage({
        diff: stagedDiff.diff,
        stagedFileCount: getStagedFileCount(),
        astContext
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

      const workdirDiffParts = await Promise.all(
        files.map(async (filePath) => {
          const result = await invokeGit('diff.workdirRaw', { path: filePath })
          return result.diff
        })
      )
      const workdirGroupDiff = workdirDiffParts.filter(Boolean).join('\n')
      const appliedPatch = workdirGroupDiff.trim() ? await applyGroupHunks(group, workdirGroupDiff) : null

      if (!appliedPatch) {
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
        astContext: renderAstContext(files, groupDiff, astContentMap)
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
