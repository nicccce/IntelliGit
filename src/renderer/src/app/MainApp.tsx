import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Spin } from 'antd'

import { useAppStore } from '../store'
import AppShell from '../layout/AppShell'
import { AppProviders } from './AppProviders'
import { useAutoRefresh } from './useAutoRefresh'
import { useThemeMode } from './useThemeMode'

function MainApp(): JSX.Element {
  const configLoaded = useAppStore((state) => state.configLoaded)
  const loadConfig = useAppStore((state) => state.loadConfig)
  const activeView = useAppStore((state) => state.activeView)
  const loading = useAppStore((state) => state.loading)
  const currentRepo = useAppStore((state) => state.currentRepo)
  const refreshAllLocal = useAppStore((state) => state.refreshAllLocal)

  const { themeMode, toggleTheme } = useThemeMode()
  const [repoPanelOpen, setRepoPanelOpen] = useState(false)

  const toggleRepoPanel = useCallback(() => {
    setRepoPanelOpen((prev) => !prev)
  }, [])

  useEffect(() => {
    loadConfig()
  }, [loadConfig])

  useAutoRefresh(currentRepo?.path, refreshAllLocal)

  if (!configLoaded) {
    return (
      <AppProviders themeMode={themeMode}>
        <div className="ig-loading-screen">
          <Spin size="large" />
          <p>加载中…</p>
        </div>
      </AppProviders>
    )
  }

  return (
    <AppProviders themeMode={themeMode}>
      <AppShell
        activeView={activeView}
        currentRepoPath={currentRepo?.path}
        loading={loading}
        repoPanelOpen={repoPanelOpen}
        themeMode={themeMode}
        onToggleRepoPanel={toggleRepoPanel}
        onToggleTheme={toggleTheme}
      />
    </AppProviders>
  )
}

export default MainApp
