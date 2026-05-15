import type React from 'react'
import { CodeOutlined, HistoryOutlined, SettingOutlined } from '@ant-design/icons'

import type { AppView } from './types'

export const VIEW_OPTIONS: Array<{ value: AppView; label: string; icon: React.ReactNode }> = [
  { value: 'changes', label: '变更', icon: <CodeOutlined /> },
  { value: 'history', label: '历史', icon: <HistoryOutlined /> },
  { value: 'settings', label: '设置', icon: <SettingOutlined /> }
]
