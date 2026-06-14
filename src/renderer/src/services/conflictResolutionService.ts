import { runAgentWithFallback } from '../agent/agentRuntime'
import { CONFLICT_SYSTEM_PROMPT, renderConflictResolvePrompt } from '../agent/prompts/conflict'
import { CONFLICT_RESOLVE_SCHEMA, parseStructured } from '../agent/outputParser'
import type { LlmConfig } from '../agent/types'

export interface ConflictResolutionInput {
  filePath: string
  ancestor: string
  ours: string
  theirs: string
  context?: string
}

export interface ConflictResolutionSuggestion {
  strategy: 'take_ours' | 'take_theirs' | 'merge_both' | 'manual'
  explanation: string
  resolvedContent?: string
  warnings?: string[]
  fallback?: boolean
}

function compactLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function overlapRatio(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0
  const rightSet = new Set(right)
  const overlap = left.filter((line) => rightSet.has(line)).length
  return overlap / Math.max(left.length, right.length)
}

export function buildRuleBasedConflictSuggestion(input: ConflictResolutionInput): ConflictResolutionSuggestion {
  const ours = input.ours.trim()
  const theirs = input.theirs.trim()
  const ancestor = input.ancestor.trim()

  if (ours && !theirs) {
    return {
      strategy: 'take_ours',
      resolvedContent: ours,
      explanation: 'theirs 为空且 ours 包含有效内容，倾向保留当前分支变更。',
      warnings: ancestor ? ['仍需确认目标分支是否有意删除该区域。'] : ['缺少 ancestor，建议应用后运行测试。'],
      fallback: true
    }
  }

  if (!ours && theirs) {
    return {
      strategy: 'take_theirs',
      resolvedContent: theirs,
      explanation: 'ours 为空且 theirs 包含有效内容，倾向采纳合入分支变更。',
      warnings: ancestor ? ['仍需确认当前分支是否有意删除该区域。'] : ['缺少 ancestor，建议应用后运行测试。'],
      fallback: true
    }
  }

  if (ours === theirs && ours) {
    return {
      strategy: 'merge_both',
      resolvedContent: ours,
      explanation: 'ours 与 theirs 内容一致，可直接使用任一侧结果。',
      warnings: [],
      fallback: true
    }
  }

  const oursLines = compactLines(ours)
  const theirsLines = compactLines(theirs)
  const ancestorLines = compactLines(ancestor)
  const sideOverlap = overlapRatio(oursLines, theirsLines)
  const oursVsAncestor = overlapRatio(oursLines, ancestorLines)
  const theirsVsAncestor = overlapRatio(theirsLines, ancestorLines)

  if (sideOverlap > 0.65) {
    const merged = Array.from(new Set([...oursLines, ...theirsLines])).join('\n')
    return {
      strategy: 'merge_both',
      resolvedContent: merged || `${ours}\n${theirs}`.trim(),
      explanation: '双方内容高度重叠，建议合并双方非重复逻辑。',
      warnings: ['规则合并仅去重文本行，复杂代码请人工审查格式和控制流。'],
      fallback: true
    }
  }

  if (ancestor && oursVsAncestor > 0.8 && theirsVsAncestor < 0.5) {
    return {
      strategy: 'take_theirs',
      resolvedContent: theirs,
      explanation: 'ours 更接近 ancestor，theirs 看起来承载主要变更，建议优先采纳 theirs。',
      warnings: ['请确认当前分支没有必须保留的上下文调整。'],
      fallback: true
    }
  }

  if (ancestor && theirsVsAncestor > 0.8 && oursVsAncestor < 0.5) {
    return {
      strategy: 'take_ours',
      resolvedContent: ours,
      explanation: 'theirs 更接近 ancestor，ours 看起来承载主要变更，建议优先保留 ours。',
      warnings: ['请确认目标分支没有必须保留的上下文调整。'],
      fallback: true
    }
  }

  return {
    strategy: 'manual',
    resolvedContent: [ours, theirs].filter(Boolean).join('\n\n'),
    explanation: '双方变更差异较大，无法通过规则安全判断语义意图，建议人工合并。',
    warnings: ['应用前请检查调用关系、函数签名和类型定义，合并后运行构建或测试。'],
    fallback: true
  }
}

export async function suggestConflictResolution(
  config: LlmConfig | undefined,
  input: ConflictResolutionInput
): Promise<ConflictResolutionSuggestion> {
  const ruleBased = buildRuleBasedConflictSuggestion(input)

  const result = await runAgentWithFallback<ConflictResolutionSuggestion>(
    config,
    {
      taskType: 'conflict.suggestResolution',
      systemPrompt: CONFLICT_SYSTEM_PROMPT,
      userMessage: renderConflictResolvePrompt(input.filePath, input.ancestor, input.ours, input.theirs, input.context || ''),
      context: input
    },
    (rawOutput) => parseStructured<ConflictResolutionSuggestion>(rawOutput, CONFLICT_RESOLVE_SCHEMA)
  )

  if (!result.success || !result.data) return ruleBased

  return {
    ...ruleBased,
    ...result.data,
    resolvedContent: result.data.resolvedContent || ruleBased.resolvedContent,
    warnings: result.data.warnings?.length ? result.data.warnings : ruleBased.warnings,
    fallback: result.fallback
  }
}
