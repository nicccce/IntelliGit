import { detectSemanticConflictRisks } from '../utils/astChangeAnalyzer'
import type { SemanticConflictRisk } from '../utils/astChangeAnalyzer'

export interface ConflictRiskFileSummary {
  filePath: string
  level: SemanticConflictRisk['level']
  score: number
  riskCount: number
  symbols: string[]
  reasons: string[]
}

export interface ConflictRiskReport {
  risks: SemanticConflictRisk[]
  files: ConflictRiskFileSummary[]
  summary: string
}

const LEVEL_SCORE: Record<SemanticConflictRisk['level'], number> = {
  low: 1,
  medium: 2,
  high: 3
}

function maxLevel(left: SemanticConflictRisk['level'], right: SemanticConflictRisk['level']): SemanticConflictRisk['level'] {
  return LEVEL_SCORE[left] >= LEVEL_SCORE[right] ? left : right
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function levelLabel(level: SemanticConflictRisk['level']): string {
  if (level === 'high') return '高风险'
  if (level === 'medium') return '中风险'
  return '低风险'
}

export async function buildConflictRiskReport(
  files: string[],
  oursDiff: string,
  theirsDiff: string = oursDiff
): Promise<ConflictRiskReport> {
  const risks = await detectSemanticConflictRisks(files, oursDiff, files, theirsDiff)
  const fileMap = new Map<string, ConflictRiskFileSummary>()

  for (const risk of risks) {
    for (const filePath of risk.files) {
      const existing = fileMap.get(filePath)
      if (existing) {
        existing.level = maxLevel(existing.level, risk.level)
        existing.score += LEVEL_SCORE[risk.level]
        existing.riskCount += 1
        existing.symbols = unique([...existing.symbols, ...risk.symbols])
        existing.reasons = unique([...existing.reasons, `${risk.type}：${risk.description}`])
      } else {
        fileMap.set(filePath, {
          filePath,
          level: risk.level,
          score: LEVEL_SCORE[risk.level],
          riskCount: 1,
          symbols: unique(risk.symbols),
          reasons: [`${risk.type}：${risk.description}`]
        })
      }
    }
  }

  const filesWithRisk = Array.from(fileMap.values()).sort((left, right) => {
    const byScore = right.score - left.score
    if (byScore !== 0) return byScore
    return left.filePath.localeCompare(right.filePath)
  })

  const highCount = risks.filter((risk) => risk.level === 'high').length
  const mediumCount = risks.filter((risk) => risk.level === 'medium').length
  const lowCount = risks.filter((risk) => risk.level === 'low').length
  const summary = risks.length
    ? `共识别 ${risks.length} 个语义风险：高 ${highCount} / 中 ${mediumCount} / 低 ${lowCount}，涉及 ${filesWithRisk.length} 个文件。`
    : '暂未识别到 AST 级语义冲突风险，可继续按文本冲突流程审查。'

  return {
    risks,
    files: filesWithRisk,
    summary
  }
}

export function formatFileRiskTitle(file: ConflictRiskFileSummary): string {
  const symbolText = file.symbols.length ? `，符号：${file.symbols.slice(0, 4).join('、')}` : ''
  return `${levelLabel(file.level)} · ${file.riskCount} 个风险${symbolText}`
}

/**
 * 从 ancestor/ours/theirs 原始内容构建合成 unified diff，
 * 供 AST 分析器（parseFileDiffs）解析使用。
 * 将 oldContent 全行标为 `-`，newContent 全行标为 `+`，
 * 保证 buildApproximateSourceFromDiff 能准确还原两侧内容。
 */
export function buildSyntheticUnifiedDiff(filePath: string, oldContent: string, newContent: string): string {
  const path = filePath.replace(/\\/g, '/')
  const oldLines = (oldContent ?? '').split('\n')
  const newLines = (newContent ?? '').split('\n')
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((l) => `-${l}`),
    ...newLines.map((l) => `+${l}`)
  ].join('\n')
}
