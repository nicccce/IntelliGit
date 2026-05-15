import type { JSX } from 'react'

import type { AppThemeMode, AppView } from '../../app/types'
import ActivityRail from '../ActivityRail'
import NotificationBar from '../NotificationBar'
import RepoPanel from '../RepoPanel'
import StatusBar from '../StatusBar'
import Toolbar from '../Toolbar'
import ChangesView from '../../views/ChangesView'
import HistoryView from '../../views/HistoryView'
import SettingsView from '../../views/SettingsView'
import styles from './AppShell.module.css'

interface AppShellProps {
  activeView: AppView
  currentRepoPath: string | undefined
  loading: boolean
  repoPanelOpen: boolean
  themeMode: AppThemeMode
  onToggleRepoPanel: () => void
  onToggleTheme: () => void
}

function AppShell({
  activeView,
  currentRepoPath,
  loading,
  repoPanelOpen,
  themeMode,
  onToggleRepoPanel,
  onToggleTheme
}: AppShellProps): JSX.Element {
  return (
    <div className={styles['ig-app']} data-theme-mode={themeMode}>
      <Toolbar />
      <NotificationBar />
      {loading && currentRepoPath && (
        <div className={styles['ig-loading-bar']}>
          <div className={styles['ig-loading-bar-inner']} />
        </div>
      )}
      <div className={styles['ig-workbench']}>
        <ActivityRail
          repoPanelOpen={repoPanelOpen}
          themeMode={themeMode}
          onToggleRepoPanel={onToggleRepoPanel}
          onToggleTheme={onToggleTheme}
        />
        <RepoPanel isOpen={repoPanelOpen} onClose={onToggleRepoPanel} />
        <main className={styles['ig-content']}>
          {activeView === 'changes' && <ChangesView />}
          {activeView === 'history' && <HistoryView />}
          {activeView === 'settings' && <SettingsView key={currentRepoPath || 'settings'} />}
        </main>
      </div>
      <StatusBar />
    </div>
  )
}

export default AppShell
