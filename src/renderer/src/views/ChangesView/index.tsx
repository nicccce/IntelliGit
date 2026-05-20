import type { JSX } from 'react'
import { useRef, useState, useCallback } from 'react'
import { Button, Empty } from 'antd'
import { CloseOutlined, PlusOutlined } from '@ant-design/icons'

import { addAll, addFile, removeFile } from '../../services/gitWorkflowService'
import { useChangesViewModel } from '../../viewModels'
import type { DiffSource } from '../../viewModels'
import { useResizable } from '../../hooks'
import CommitPanel from './CommitPanel'
import DiffPane from './DiffPane'
import FileSection from './FileSection'
import type { FileSelectionState } from './FileSection'
import styles from './ChangesView.module.css'

function ChangesView(): JSX.Element {
  const {
    currentRepo,
    selectedFilePath,
    diffSource,
    selectFile,
    staged,
    unstaged,
    isBusy,
    isCommitRunning
  } = useChangesViewModel()

  // ---------- 文件选择状态缓存 ----------
  // key = `${diffSource}::${filePath}`; value = FileSelectionState
  const [fileSelMap, setFileSelMap] = useState<Record<string, FileSelectionState>>({})

  const handleSelectionChange = useCallback(
    (source: DiffSource, filePath: string, state: FileSelectionState) => {
      const key = `${source}::${filePath}`
      setFileSelMap((prev) => {
        if (prev[key] === state) return prev
        return { ...prev, [key]: state }
      })
    },
    []
  )

  /** 获取某个文件的选择状态（默认未暂存区全选；已暂存区则使用缓存） */
  const getSelectionState = useCallback(
    (source: DiffSource, filePath: string): FileSelectionState => {
      return fileSelMap[`${source}::${filePath}`] ?? 'all'
    },
    [fileSelMap]
  )

  const handleSelectFile = (source: DiffSource) => (path: string) => {
    selectFile(path, source)
  }

  // 左右分割（水平方向），默认左侧占比 40%，最小 25%，最大 55%
  const horizontalContainerRef = useRef<HTMLDivElement>(null)
  const {
    ratio: horizontalRatio,
    handleMouseDown: onHorizontalResize,
    isDragging: isHResizing
  } = useResizable({
    direction: 'horizontal',
    defaultRatio: 0.23,
    minRatio: 0.15,
    maxRatio: 0.5,
    containerRef: horizontalContainerRef
  })

  // 已暂存 / 未暂存之间的垂直分割，默认各占 50%
  const verticalContainerRef = useRef<HTMLDivElement>(null)
  const {
    ratio: stagedRatio,
    handleMouseDown: onVerticalResize,
    isDragging: isVResizing
  } = useResizable({
    direction: 'vertical',
    defaultRatio: 0.5,
    minRatio: 0.2,
    maxRatio: 0.8,
    containerRef: verticalContainerRef
  })

  if (!currentRepo) {
    return (
      <div className={styles['ig-empty-view']}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一个仓库开始" />
        <p>从左侧缩略图栏添加或选择 Git 仓库</p>
      </div>
    )
  }

  return (
    <div
      className={`${styles['ig-changes-view']} ${isHResizing ? styles['ig-resizing-h'] : ''}`}
      ref={horizontalContainerRef}
      id="changes-view"
    >
      {/* ---------- 左侧区域 ---------- */}
      <div className={styles['ig-left-panel']} style={{ width: `${horizontalRatio * 100}%` }}>
        {/* 上部分：未暂存 + 已暂存（可调节高度比例） */}
        <div
          className={`${styles['ig-stage-area']} ${isVResizing ? styles['ig-resizing-v'] : ''}`}
          ref={verticalContainerRef}
        >
          <div className={styles['ig-stage-section']} style={{ height: `${stagedRatio * 100}%` }}>
            <FileSection
              isSelectedSource={diffSource === 'unstaged'}
              title="未暂存"
              emptyDescription="工作区干净"
              files={unstaged}
              selectedFilePath={selectedFilePath}
              actionTitle="暂存"
              actionIcon={<PlusOutlined />}
              statusCode={(file) => file.worktree || file.staging}
              onSelectFile={handleSelectFile('unstaged')}
              onFileAction={addFile}
              getSelectionState={(filePath) => getSelectionState('unstaged', filePath)}
              headerAction={
                <Button
                  size="small"
                  type="link"
                  onClick={addAll}
                  disabled={unstaged.length === 0 || isBusy}
                >
                  全部暂存
                </Button>
              }
            />
          </div>

          {/* 垂直拖拽手柄（未暂存 / 已暂存之间） */}
          <div className={styles['ig-divider-v']} onMouseDown={onVerticalResize}>
            <div className={styles['ig-divider-v-handle']} />
          </div>

          <div
            className={styles['ig-stage-section']}
            style={{ height: `${(1 - stagedRatio) * 100}%` }}
          >
            <FileSection
              isSelectedSource={diffSource === 'staged'}
              title="已暂存"
              emptyDescription="无暂存文件"
              files={staged}
              selectedFilePath={selectedFilePath}
              actionTitle="取消暂存"
              actionIcon={<CloseOutlined />}
              statusCode={(file) => file.staging}
              onSelectFile={handleSelectFile('staged')}
              onFileAction={removeFile}
              getSelectionState={(filePath) => getSelectionState('staged', filePath)}
            />
          </div>
        </div>

        {/* 左下：提交面板（固定高度） */}
        <div className={styles['ig-commit-anchor']}>
          <CommitPanel
            stagedCount={staged.length}
            isBusy={isBusy}
            isCommitRunning={isCommitRunning}
          />
        </div>
      </div>

      {/* 水平拖拽手柄 */}
      <div className={styles['ig-divider-h']} onMouseDown={onHorizontalResize}>
        <div className={styles['ig-divider-h-handle']} />
      </div>

      {/* ---------- 右侧：Diff 面板 ---------- */}
      <div className={styles['ig-right-panel']}>
        <DiffPane
          selectedFilePath={selectedFilePath}
          diffSource={diffSource}
          onSelectionChange={handleSelectionChange}
        />
      </div>
    </div>
  )
}

export default ChangesView
