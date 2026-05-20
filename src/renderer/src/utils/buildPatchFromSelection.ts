/**
 * 根据 diff 结构中的 chunks 和用户的行级选择集，构造一个 unified diff patch，
 * 仅包含被选择的 Add/Delete 行。
 *
 * patch 格式要求：
 *   diff --git a/{fromPath} b/{toPath}
 *   index {hash}..{hash} 100644 (optional)
 *   --- a/{fromPath}
 *   +++ b/{toPath}
 *   @@ -start,count +start,count @@
 *   {selected lines with +/- prefix}
 *
 * 注意：该工具只处理单个文件 patch（filePatches 通常只有一个元素），
 * 但为了通用性支持多 filePatches 拼接。
 */

import type { PatchDetail } from '../../../shared/types'

/**
 * 从 PatchDetail 的 filePatches 和 selectedSet 构建完整的 unified diff patch 字符串。
 *
 * @param diff - 完整的 PatchDetail
 * @param selectedSet - 选中的行级 key 集合，格式为 `${filePatchIndex}-${chunkIndex}-${lineIndex}`
 * @returns 可用于 git apply --cached 的 patch 字符串。若无可选行返回空字符串。
 */
export function buildPatchFromSelection(
  diff: PatchDetail | null,
  selectedSet: Set<string>
): string {
  if (!diff) return ''

  const patchParts: string[] = []

  for (let fi = 0; fi < diff.filePatches.length; fi++) {
    const fp = diff.filePatches[fi]
    if (fp.isBinary) continue

    const fromPath = fp.fromPath || fp.toPath
    const toPath = fp.toPath || fp.fromPath
    if (!fromPath || !toPath) continue

    // 判断该 filePatch 是否有任何选中行
    let hasAnySelected = false
    for (let ci = 0; ci < fp.chunks.length; ci++) {
      const chunk = fp.chunks[ci]
      if (chunk.type === 'Equal') continue
      const lines = chunk.content.split('\n')
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      for (let li = 0; li < lines.length; li++) {
        if (selectedSet.has(`${fi}-${ci}-${li}`)) {
          hasAnySelected = true
          break
        }
      }
      if (hasAnySelected) break
    }
    if (!hasAnySelected) continue

    // diff 头部
    patchParts.push(`diff --git a/${fromPath} b/${toPath}`)

    // 判断是否为新增文件
    const allAdd = fp.chunks.length > 0 && fp.chunks.every((c) => c.type === 'Add')
    const isNewFile = allAdd || fromPath !== toPath

    if (isNewFile) {
      patchParts.push('new file mode 100644')
      patchParts.push('--- /dev/null')
      patchParts.push('+++ b/' + toPath)
    } else {
      patchParts.push('--- a/' + fromPath)
      patchParts.push('+++ b/' + toPath)
    }

    // 计算每个 chunk 的累积行偏移
    let oldOffset = 1
    let newOffset = 1
    const chunkStarts: Array<{ oldStart: number; newStart: number; lines: string[] }> = []

    for (let ci = 0; ci < fp.chunks.length; ci++) {
      const chunk = fp.chunks[ci]
      const lines = chunk.content.split('\n')
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

      chunkStarts.push({
        oldStart: oldOffset,
        newStart: newOffset,
        lines
      })

      if (chunk.type !== 'Add') oldOffset += lines.length
      if (chunk.type !== 'Delete') newOffset += lines.length
    }

    // 为每个有选中行的 chunk 生成一个 hunk（纯 Add 或纯 Delete，不可能混在同一个 chunk 中）
    for (let ci = 0; ci < fp.chunks.length; ci++) {
      const chunk = fp.chunks[ci]
      if (chunk.type === 'Equal') continue

      const { oldStart, newStart, lines } = chunkStarts[ci]

      // 收集选中行的内容
      const selectedLines: string[] = []
      let firstSelIndex = -1
      for (let li = 0; li < lines.length; li++) {
        if (selectedSet.has(`${fi}-${ci}-${li}`)) {
          if (firstSelIndex === -1) firstSelIndex = li
          const prefix = chunk.type === 'Add' ? '+' : '-'
          selectedLines.push(prefix + lines[li])
        }
      }

      if (selectedLines.length === 0) continue

      if (chunk.type === 'Add') {
        // Add chunk: old region has 0 lines, new region has selectedLines.length lines
        const hunkNewStart = newStart + firstSelIndex
        patchParts.push(`@@ -${hunkNewStart},0 +${hunkNewStart},${selectedLines.length} @@`)
      } else {
        // Delete chunk: old region has selectedLines.length lines, new region has 0 lines
        const hunkOldStart = oldStart + firstSelIndex
        patchParts.push(`@@ -${hunkOldStart},${selectedLines.length} +${hunkOldStart},0 @@`)
      }

      for (const line of selectedLines) {
        patchParts.push(line)
      }
    }

    patchParts.push('')
  }

  return patchParts.join('\n')
}
