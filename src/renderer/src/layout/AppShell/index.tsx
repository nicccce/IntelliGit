import type { JSX } from 'react'

import type { AppThemeMode, AppView, SidePanel } from '../../app/types'
import ActivityRail from '../ActivityRail'
import ChatPanel from '../ChatPanel'
import ConflictPanel from '../ConflictPanel'
import GlobalSettingsPanel from '../GlobalSettingsPanel'
import NotificationBar from '../NotificationBar'
import RepoPanel from '../RepoPanel'
import StatusBar from '../StatusBar'
import Toolbar from '../Toolbar'
import ChangesView from '../../views/ChangesView'
import HistoryView from '../../views/HistoryView'
import SettingsView from '../../views/SettingsView'
import NlpView from '../../views/NlpView'
import styles from './AppShell.module.css'

interface AppShellProps {
  activeView: AppView
  activeSidePanel: SidePanel
  currentRepoPath: string | undefined
  loading: boolean
  themeMode: AppThemeMode
  onToggleSidePanel: (panel: SidePanel) => void
  onToggleTheme: () => void
}

function AppShell({
  activeView,
  activeSidePanel,
  currentRepoPath,
  loading,
  themeMode,
  onToggleSidePanel,
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
          activeSidePanel={activeSidePanel}
          themeMode={themeMode}
          onToggleSidePanel={onToggleSidePanel}
          onToggleTheme={onToggleTheme}
        />
        {activeSidePanel === 'repo' && (
          <RepoPanel isOpen={true} onClose={() => onToggleSidePanel('repo')} />
        )}
        {activeSidePanel === 'chat' && (
          <ChatPanel isOpen={true} onClose={() => onToggleSidePanel('chat')} />
        )}
        {activeSidePanel === 'conflict' && (
          <ConflictPanel isOpen={true} onClose={() => onToggleSidePanel('conflict')} />
        )}
        {activeSidePanel === 'settings' && (
          <GlobalSettingsPanel isOpen={true} onClose={() => onToggleSidePanel('settings')} />
        )}
        <main className={styles['ig-content']}>
          {activeView === 'changes' && <ChangesView />}
          {activeView === 'history' && <HistoryView />}
          {activeView === 'settings' && <SettingsView key={currentRepoPath || 'settings'} />}
          {activeView === 'nlp' && <NlpView />}
        </main>
      </div>
      <StatusBar />
    </div>
  )
}

export default AppShell
