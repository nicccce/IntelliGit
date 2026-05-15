import type { JSX, ReactNode } from 'react'
import { App as AntApp, ConfigProvider } from 'antd'

import { ANT_THEME_TOKENS } from './appTheme'
import type { AppThemeMode } from './types'

interface AppProvidersProps {
  children: ReactNode
  themeMode: AppThemeMode
}

export function AppProviders({ children, themeMode }: AppProvidersProps): JSX.Element {
  return (
    <ConfigProvider theme={ANT_THEME_TOKENS[themeMode]}>
      <AntApp className="ig-ant-root">{children}</AntApp>
    </ConfigProvider>
  )
}
