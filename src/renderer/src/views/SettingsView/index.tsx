import type { JSX } from 'react'
import { useState } from 'react'
import { Button, Empty, Input, Segmented } from 'antd'

import { useSettingsViewModel } from '../../viewModels'
import styles from './SettingsView.module.css'

type RemoteType = 'none' | 'http' | 'ssh'

function SettingsView(): JSX.Element {
  const { currentRepo, updateRepoSettings } = useSettingsViewModel()

  const [commitAuthorName, setCommitAuthorName] = useState<string>(
    () => currentRepo?.commitAuthorName || ''
  )
  const [commitAuthorEmail, setCommitAuthorEmail] = useState<string>(
    () => currentRepo?.commitAuthorEmail || ''
  )
  const [remoteType, setRemoteType] = useState<RemoteType>(() => currentRepo?.remoteType || 'none')
  const [httpRemoteUrl, setHttpRemoteUrl] = useState<string>(() => currentRepo?.httpRemoteUrl || '')
  const [sshRemoteUrl, setSshRemoteUrl] = useState<string>(() => currentRepo?.sshRemoteUrl || '')
  const [username, setUsername] = useState<string>(() => currentRepo?.authUsername || '')
  const [password, setPassword] = useState<string>(() => currentRepo?.authPassword || '')
  const [sshKeyPath, setSshKeyPath] = useState<string>(() => currentRepo?.sshKeyPath || '')
  const [sshPassword, setSshPassword] = useState<string>(() => currentRepo?.sshPassword || '')

  if (!currentRepo) {
    return (
      <div className={styles['ig-empty-view']}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择仓库进行设置" />
      </div>
    )
  }

  const handleSave = (): void => {
    updateRepoSettings(currentRepo.path, {
      commitAuthorName: commitAuthorName.trim() || undefined,
      commitAuthorEmail: commitAuthorEmail.trim() || undefined,
      remoteType,
      httpRemoteUrl: remoteType === 'http' ? httpRemoteUrl.trim() || undefined : undefined,
      sshRemoteUrl: remoteType === 'ssh' ? sshRemoteUrl.trim() || undefined : undefined,
      authUsername: remoteType === 'http' ? username.trim() || undefined : undefined,
      authPassword: remoteType === 'http' ? password.trim() || undefined : undefined,
      sshKeyPath: remoteType === 'ssh' ? sshKeyPath.trim() || undefined : undefined,
      sshPassword: remoteType === 'ssh' ? sshPassword.trim() || undefined : undefined
    })
  }

  return (
    <div className={styles['ig-settings-view']} id="settings-view">
      <div className={styles['ig-settings-section']}>
        <h3>仓库信息</h3>
        <div className={styles['ig-settings-info']}>
          <div className={styles['ig-settings-row']}>
            <span className={styles['ig-settings-label']}>名称</span>
            <span className={styles['ig-settings-value']}>{currentRepo.name}</span>
          </div>
          <div className={styles['ig-settings-row']}>
            <span className={styles['ig-settings-label']}>路径</span>
            <span className={`${styles['ig-settings-value']} ${styles['ig-mono']}`}>
              {currentRepo.path}
            </span>
          </div>
        </div>
      </div>
      <div className={styles['ig-settings-section']}>
        <h3>提交身份</h3>
        <p className={styles['ig-hint']}>用于新建 Commit；GitHub 贡献统计按提交邮箱匹配账号</p>
        <div className={styles['ig-form-group']}>
          <label>作者名称</label>
          <Input
            value={commitAuthorName}
            onChange={(event) => setCommitAuthorName(event.target.value)}
            placeholder="留空时使用 Git 配置或认证用户名"
          />
        </div>
        <div className={styles['ig-form-group']}>
          <label>作者邮箱</label>
          <Input
            value={commitAuthorEmail}
            onChange={(event) => setCommitAuthorEmail(event.target.value)}
            placeholder="your-email@example.com"
          />
        </div>
      </div>
      <div className={styles['ig-settings-section']}>
        <h3>远程仓库</h3>
        <p className={styles['ig-hint']}>
          选择远程仓库形式以配置 Push/Pull 等操作使用的远程地址与认证
        </p>
        <Segmented
          className={styles['ig-remote-type-group']}
          block
          value={remoteType}
          onChange={(value) => setRemoteType(value as RemoteType)}
          options={[
            { value: 'none', label: '无' },
            { value: 'http', label: 'HTTP(S)' },
            { value: 'ssh', label: 'SSH' }
          ]}
        />
        {remoteType !== 'none' && (
          <div className={styles['ig-remote-detail']}>
            {remoteType === 'http' && (
              <div className={styles['ig-form-group']}>
                <label>HTTP(S) 远程地址</label>
                <Input
                  value={httpRemoteUrl}
                  onChange={(event) => setHttpRemoteUrl(event.target.value)}
                  placeholder="https://github.com/user/repo.git"
                />
              </div>
            )}
            {remoteType === 'ssh' && (
              <div className={styles['ig-form-group']}>
                <label>SSH 远程地址</label>
                <Input
                  value={sshRemoteUrl}
                  onChange={(event) => setSshRemoteUrl(event.target.value)}
                  placeholder="git@github.com:user/repo.git"
                />
              </div>
            )}
            {remoteType === 'http' && (
              <>
                <p className={styles['ig-hint']}>HTTP(S) 认证</p>
                <div className={styles['ig-form-group']}>
                  <label>用户名</label>
                  <Input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="用户名"
                  />
                </div>
                <div className={styles['ig-form-group']}>
                  <label>密码 / Token</label>
                  <Input.Password
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="口令"
                  />
                </div>
              </>
            )}
            {remoteType === 'ssh' && (
              <>
                <p className={styles['ig-hint']}>SSH 认证</p>
                <div className={styles['ig-form-group']}>
                  <label>SSH 密钥路径</label>
                  <Input
                    value={sshKeyPath}
                    onChange={(event) => setSshKeyPath(event.target.value)}
                    placeholder="~/.ssh/id_rsa"
                  />
                </div>
                <div className={styles['ig-form-group']}>
                  <label>SSH 密钥密码</label>
                  <Input.Password
                    value={sshPassword}
                    onChange={(event) => setSshPassword(event.target.value)}
                    placeholder="（可选）"
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <Button type="primary" onClick={handleSave}>
        保存设置
      </Button>
    </div>
  )
}

export default SettingsView
