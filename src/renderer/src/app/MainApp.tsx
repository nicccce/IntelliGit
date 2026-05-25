import type { JSX } from 'react'
import { useCallback, useEffect } from 'react'
import { Spin } from 'antd'

import { useRepositoryStore, useUiStore } from '../store'
import {
  selectActiveSidePanel,
  selectActiveView,
  selectConfigLoaded,
  selectCurrentRepo,
  selectGlobalLoading,
  selectToggleSidePanel
} from '../store/selectors'
import AppShell from '../layout/AppShell'
import { loadConfig } from '../services/repositoryWorkflowService'
import { refreshAllLocal } from '../services/refreshCoordinator'
import { AppProviders } from './AppProviders'
import { useAutoRefresh } from './useAutoRefresh'
import { useSidecarHealthCheck } from './useSidecarHealthCheck'
import { useThemeMode } from './useThemeMode'
import styles from './MainApp.module.css'

function MainApp(): JSX.Element {
  const configLoaded = useRepositoryStore(selectConfigLoaded)
  const currentRepo = useRepositoryStore(selectCurrentRepo)
  const activeView = useUiStore(selectActiveView)
  const activeSidePanel = useUiStore(selectActiveSidePanel)
  const loading = useUiStore(selectGlobalLoading)
  const toggleSidePanel = useUiStore(selectToggleSidePanel)

  const { themeMode, toggleTheme } = useThemeMode()
  const refreshLocal = useCallback(() => refreshAllLocal(), [])

  useEffect(() => {
    loadConfig()
  }, [])

  useSidecarHealthCheck()
  useAutoRefresh(currentRepo?.path, refreshLocal)

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
        activeSidePanel={activeSidePanel}
        currentRepoPath={currentRepo?.path}
        loading={loading}
        themeMode={themeMode}
        onToggleSidePanel={toggleSidePanel}
        onToggleTheme={toggleTheme}
      />
    </AppProviders>
  )
}

export default MainApp
