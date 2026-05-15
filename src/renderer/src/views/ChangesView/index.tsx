import type { JSX } from 'react'
import { useCallback, useState } from 'react'
import { Button, Empty, Input, Switch, Tooltip } from 'antd'
import { CloseOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'

import DiffView from '../../components/DiffView'
import FileStatusBadge from '../../components/FileStatusBadge'
import { addAll, addFile, createCommit, removeFile } from '../../services/gitWorkflowService'
import { useDiffStore, useGitStatusStore, useOperationStore, useRepositoryStore } from '../../store'

const { TextArea } = Input

function ChangesView(): JSX.Element {
  const fileStatuses = useGitStatusStore((state) => state.fileStatuses)
  const operationLoading = useOperationStore((state) => state.operationLoading)
  const currentRepo = useRepositoryStore((state) => state.currentRepo)
  const selectedFilePath = useDiffStore((state) => state.selectedFilePath)
  const selectFile = useDiffStore((state) => state.selectFile)

  const [commitMsg, setCommitMsg] = useState('')
  const [runSandbox, setRunSandbox] = useState(false)

  const staged = fileStatuses.filter((file) => file.staging !== ' ' && file.staging !== '?')
  const unstaged = fileStatuses.filter((file) => file.worktree !== ' ' || file.staging === '?')

  const handleCommit = useCallback(async () => {
    if (!commitMsg.trim()) return
    await createCommit(commitMsg.trim())
    setCommitMsg('')
  }, [commitMsg])

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
        <div className="ig-file-section">
          <div className="ig-file-section-header">
            <h3>已暂存 ({staged.length})</h3>
          </div>
          <div className="ig-file-list">
            {staged.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无暂存文件" />
            ) : (
              staged.map((file) => (
                <div
                  key={`s-${file.path}`}
                  className={`ig-file-item ${selectedFilePath === file.path ? 'active' : ''}`}
                  onClick={() => selectFile(file.path)}
                >
                  <FileStatusBadge code={file.staging} />
                  <span className="ig-file-path">{file.path}</span>
                  <Tooltip title="取消暂存">
                    <Button
                      type="text"
                      size="small"
                      icon={<CloseOutlined />}
                      onClick={(event) => {
                        event.stopPropagation()
                        removeFile(file.path)
                      }}
                    />
                  </Tooltip>
                </div>
              ))
            )}
          </div>
        </div>
        <div className="ig-file-section">
          <div className="ig-file-section-header">
            <h3>未暂存 ({unstaged.length})</h3>
            <Button
              size="small"
              type="link"
              onClick={addAll}
              disabled={unstaged.length === 0 || !!operationLoading}
            >
              全部暂存
            </Button>
          </div>
          <div className="ig-file-list">
            {unstaged.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="工作区干净" />
            ) : (
              unstaged.map((file) => (
                <div
                  key={`u-${file.path}`}
                  className={`ig-file-item ${selectedFilePath === file.path ? 'active' : ''}`}
                  onClick={() => selectFile(file.path)}
                >
                  <FileStatusBadge code={file.worktree || file.staging} />
                  <span className="ig-file-path">{file.path}</span>
                  <Tooltip title="暂存">
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      onClick={(event) => {
                        event.stopPropagation()
                        addFile(file.path)
                      }}
                    />
                  </Tooltip>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <div className="ig-diff-view">
        <div className="ig-diff-header">
          <span className="ig-diff-title">{selectedFilePath || '选择文件查看差异'}</span>
        </div>
        <DiffView />
      </div>
      <div className="ig-commit-panel">
        <div className="ig-commit-panel-top">提交</div>
        <Button
          className="ig-ai-btn"
          icon={<ThunderboltOutlined />}
          disabled
          title="AI 生成提交信息（即将推出）"
        >
          AI 生成提交信息
        </Button>
        <TextArea
          id="commit-message"
          className="ig-commit-input"
          placeholder="输入提交信息…"
          value={commitMsg}
          onChange={(event) => setCommitMsg(event.target.value)}
          rows={3}
        />
        <div className="ig-sandbox-row">
          <Switch size="small" checked={runSandbox} onChange={setRunSandbox} />
          <span>提交前运行沙箱验证</span>
        </div>
        <Button
          id="btn-commit"
          className="ig-commit-btn"
          type="primary"
          onClick={handleCommit}
          disabled={!commitMsg.trim() || staged.length === 0 || !!operationLoading}
          loading={operationLoading === 'commit.create'}
        >
          {`提交 (${staged.length} 个文件已暂存)`}
        </Button>
      </div>
    </div>
  )
}

export default ChangesView
