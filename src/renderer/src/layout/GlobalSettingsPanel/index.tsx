import type { JSX } from 'react'
import { GlobalOutlined, KeyOutlined, UserOutlined } from '@ant-design/icons'

import SidePanelShell from '../../components/SidePanelShell'
import styles from './GlobalSettingsPanel.module.css'

interface GlobalSettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

function GlobalSettingsPanel({ isOpen, onClose }: GlobalSettingsPanelProps): JSX.Element | null {
  if (!isOpen) return null

  return (
    <SidePanelShell title="全局设置" isOpen={isOpen} onClose={onClose}>
      <div className={styles['ig-settings-placeholder']}>
        <GlobalOutlined className={styles['ig-settings-placeholder-icon']} />
        <p>全局设置</p>
        <div className={styles['ig-settings-item']}>
          <UserOutlined />
          <span>Git 身份信息配置</span>
        </div>
        <div className={styles['ig-settings-item']}>
          <KeyOutlined />
          <span>认证凭据管理</span>
        </div>
        <p className={styles['ig-settings-placeholder-hint']}>
          全局设置即将上线，
          <br />
          此处配置的内容会应用于所有仓库
        </p>
      </div>
    </SidePanelShell>
  )
}

export default GlobalSettingsPanel
