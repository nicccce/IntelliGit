import type { JSX } from 'react'

import { useAppStore } from '../../store'

function DiffView(): JSX.Element {
  const workdirDiff = useAppStore((state) => state.workdirDiff)
  const selectedFilePath = useAppStore((state) => state.selectedFilePath)

  if (!selectedFilePath) return <div className="ig-diff-empty">← 选择文件查看差异</div>
  if (!workdirDiff || workdirDiff.filePatches.length === 0)
    return <div className="ig-diff-empty">无差异内容</div>

  return (
    <div className="ig-diff-scroll">
      {workdirDiff.filePatches.map((filePatch, filePatchIndex) => (
        <div key={filePatchIndex}>
          {filePatch.isBinary ? (
            <div className="ig-diff-binary">二进制文件</div>
          ) : (
            filePatch.chunks.map((chunk, chunkIndex) => {
              const lines = chunk.content.replace(/\n$/, '').split('\n')
              return (
                <div key={chunkIndex} className="ig-diff-chunk">
                  {chunk.type !== 'Equal' && (
                    <div className="ig-diff-hunk-hdr">
                      <span>
                        {chunk.type === 'Add' ? '新增' : '删除'} {lines.length} 行
                      </span>
                    </div>
                  )}
                  {lines.map((line, lineIndex) => (
                    <div
                      key={lineIndex}
                      className={`ig-diff-line ${
                        chunk.type === 'Add' ? 'added' : chunk.type === 'Delete' ? 'removed' : ''
                      }`}
                    >
                      <span className="ig-diff-ln">{lineIndex + 1}</span>
                      <span className="ig-diff-lc">
                        {chunk.type === 'Add' ? '+' : chunk.type === 'Delete' ? '-' : ' '} {line}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })
          )}
        </div>
      ))}
    </div>
  )
}

export default DiffView
