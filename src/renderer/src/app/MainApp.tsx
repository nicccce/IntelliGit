import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Spin } from 'antd'

import { useRepositoryStore, useUiStore } from '../store'
import {
  selectActiveView,
  selectConfigLoaded,
  selectCurrentRepo,
  selectGlobalLoading
} from '../store/selectors'
import AppShell from '../layout/AppShell'
import { loadConfig } from '../services/repositoryWorkflowService'
import { refreshAllLocal } from '../services/refreshCoordinator'
import { AppProviders } from './AppProviders'
import { useAutoRefresh } from './useAutoRefresh'
import { useThemeMode } from './useThemeMode'
import styles from './MainApp.module.css'

function MainApp(): JSX.Element {
  const configLoaded = useRepositoryStore(selectConfigLoaded)
  const currentRepo = useRepositoryStore(selectCurrentRepo)
  const activeView = useUiStore(selectActiveView)
  const loading = useUiStore(selectGlobalLoading)

  const { themeMode, toggleTheme } = useThemeMode()
  const [repoPanelOpen, setRepoPanelOpen] = useState(false)

  const toggleRepoPanel = useCallback(() => {
    setRepoPanelOpen((prev) => !prev)
  }, [])

  useEffect(() => {
    loadConfig()
  }, [])

  useAutoRefresh(currentRepo?.path, refreshAllLocal)

  if (!configLoaded) {
    return (
      <AppProviders themeMode={themeMode}>
        <div className={styles['ig-loading-screen']}>
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
