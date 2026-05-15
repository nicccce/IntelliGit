import type { JSX } from 'react'
import { Button, Empty } from 'antd'
import { CloseOutlined, PlusOutlined } from '@ant-design/icons'

import { addAll, addFile, removeFile } from '../../services/gitWorkflowService'
import { useChangesViewModel } from '../../viewModels'
import CommitPanel from './CommitPanel'
import DiffPane from './DiffPane'
import FileSection from './FileSection'

function ChangesView(): JSX.Element {
  const { currentRepo, selectedFilePath, selectFile, staged, unstaged, isBusy, isCommitRunning } =
    useChangesViewModel()

  if (!currentRepo) {
    return (
      <div className="ig-empty-view">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一个仓库开始" />
        <p>从左侧缩略图栏添加或选择 Git 仓库</p>
      </div>
    )
  }

  return (
    <div className="ig-changes-view" id="changes-view">
      <div className="ig-file-lists">
        <FileSection
          title="已暂存"
          emptyDescription="无暂存文件"
          files={staged}
          selectedFilePath={selectedFilePath}
          actionTitle="取消暂存"
          actionIcon={<CloseOutlined />}
          statusCode={(file) => file.staging}
          onSelectFile={selectFile}
          onFileAction={removeFile}
        />
        <FileSection
          title="未暂存"
          emptyDescription="工作区干净"
          files={unstaged}
          selectedFilePath={selectedFilePath}
          actionTitle="暂存"
          actionIcon={<PlusOutlined />}
          statusCode={(file) => file.worktree || file.staging}
          onSelectFile={selectFile}
          onFileAction={addFile}
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
      <DiffPane selectedFilePath={selectedFilePath} />
      <CommitPanel stagedCount={staged.length} isBusy={isBusy} isCommitRunning={isCommitRunning} />
    </div>
  )
}

export default ChangesView
