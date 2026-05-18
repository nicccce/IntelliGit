import type { JSX } from 'react'
import { useMemo, useState } from 'react'
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

  const initialValues = useMemo(
    () => ({
      commitAuthorName: currentRepo?.commitAuthorName || '',
      commitAuthorEmail: currentRepo?.commitAuthorEmail || '',
      remoteType: (currentRepo?.remoteType || 'none') as RemoteType,
      httpRemoteUrl: currentRepo?.httpRemoteUrl || '',
      sshRemoteUrl: currentRepo?.sshRemoteUrl || '',
      authUsername: currentRepo?.authUsername || '',
      authPassword: currentRepo?.authPassword || '',
      sshKeyPath: currentRepo?.sshKeyPath || '',
      sshPassword: currentRepo?.sshPassword || ''
    }),
    [currentRepo]
  )

  const fieldDirty = useMemo(
    () => ({
      commitAuthorName: commitAuthorName !== initialValues.commitAuthorName,
      commitAuthorEmail: commitAuthorEmail !== initialValues.commitAuthorEmail,
      remoteType: remoteType !== initialValues.remoteType,
      httpRemoteUrl: httpRemoteUrl !== initialValues.httpRemoteUrl,
      sshRemoteUrl: sshRemoteUrl !== initialValues.sshRemoteUrl,
      authUsername: username !== initialValues.authUsername,
      authPassword: password !== initialValues.authPassword,
      sshKeyPath: sshKeyPath !== initialValues.sshKeyPath,
      sshPassword: sshPassword !== initialValues.sshPassword
    }),
    [
      commitAuthorName,
      commitAuthorEmail,
      remoteType,
      httpRemoteUrl,
      sshRemoteUrl,
      username,
      password,
      sshKeyPath,
      sshPassword,
      initialValues
    ]
  )

  const commitIdentityDirty = fieldDirty.commitAuthorName || fieldDirty.commitAuthorEmail
  const remoteDirty =
    fieldDirty.remoteType ||
    fieldDirty.httpRemoteUrl ||
    fieldDirty.sshRemoteUrl ||
    fieldDirty.authUsername ||
    fieldDirty.authPassword ||
    fieldDirty.sshKeyPath ||
    fieldDirty.sshPassword
  const hasChanges = useMemo(() => Object.values(fieldDirty).some(Boolean), [fieldDirty])

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
      <div
        className={`${styles['ig-settings-section']}${commitIdentityDirty ? ` ${styles['ig-section-modified']}` : ''}`}
      >
        <h3 className={commitIdentityDirty ? styles['ig-modified'] : ''}>提交身份</h3>
        <p className={styles['ig-hint']}>用于新建 Commit；GitHub 贡献统计按提交邮箱匹配账号</p>
        <div
          className={`${styles['ig-form-group']}${fieldDirty.commitAuthorName ? ` ${styles['ig-modified']}` : ''}`}
        >
          <label>作者名称</label>
          <Input
            value={commitAuthorName}
            onChange={(event) => setCommitAuthorName(event.target.value)}
            placeholder="留空时使用 Git 配置或认证用户名"
          />
        </div>
        <div
          className={`${styles['ig-form-group']}${fieldDirty.commitAuthorEmail ? ` ${styles['ig-modified']}` : ''}`}
        >
          <label>作者邮箱</label>
          <Input
            value={commitAuthorEmail}
            onChange={(event) => setCommitAuthorEmail(event.target.value)}
            placeholder="your-email@example.com"
          />
        </div>
      </div>
      <div
        className={`${styles['ig-settings-section']}${remoteDirty ? ` ${styles['ig-section-modified']}` : ''}`}
      >
        <h3 className={remoteDirty ? styles['ig-modified'] : ''}>远程仓库</h3>
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
          <div
            className={`${styles['ig-remote-detail']}${fieldDirty.remoteType ? ` ${styles['ig-modified']}` : ''}`}
          >
            {remoteType === 'http' && (
              <div
                className={`${styles['ig-form-group']}${fieldDirty.httpRemoteUrl ? ` ${styles['ig-modified']}` : ''}`}
              >
                <label>HTTP(S) 远程地址</label>
                <Input
                  value={httpRemoteUrl}
                  onChange={(event) => setHttpRemoteUrl(event.target.value)}
                  placeholder="https://github.com/user/repo.git"
                />
              </div>
            )}
            {remoteType === 'ssh' && (
              <div
                className={`${styles['ig-form-group']}${fieldDirty.sshRemoteUrl ? ` ${styles['ig-modified']}` : ''}`}
              >
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
                <div
                  className={`${styles['ig-form-group']}${fieldDirty.authUsername ? ` ${styles['ig-modified']}` : ''}`}
                >
                  <label>用户名</label>
                  <Input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="用户名"
                  />
                </div>
                <div
                  className={`${styles['ig-form-group']}${fieldDirty.authPassword ? ` ${styles['ig-modified']}` : ''}`}
                >
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
                <div
                  className={`${styles['ig-form-group']}${fieldDirty.sshKeyPath ? ` ${styles['ig-modified']}` : ''}`}
                >
                  <label>SSH 密钥路径</label>
                  <Input
                    value={sshKeyPath}
                    onChange={(event) => setSshKeyPath(event.target.value)}
                    placeholder="~/.ssh/id_rsa"
                  />
                </div>
                <div
                  className={`${styles['ig-form-group']}${fieldDirty.sshPassword ? ` ${styles['ig-modified']}` : ''}`}
                >
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
      <Button type="primary" onClick={handleSave} disabled={!hasChanges}>
        保存设置
      </Button>
    </div>
  )
}

export default SettingsView
