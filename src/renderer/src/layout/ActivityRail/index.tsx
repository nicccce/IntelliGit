import type { JSX } from 'react'
import { Badge, Tooltip } from 'antd'
import { FolderOpenOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'

import type { AppThemeMode } from '../../app/types'
import { VIEW_OPTIONS } from '../../app/viewOptions'
import { classNames } from '../../utils/classNames'
import { useActivityRailModel } from '../../viewModels'
import styles from './ActivityRail.module.css'

interface ActivityRailProps {
  themeMode: AppThemeMode
  repoPanelOpen: boolean
  onToggleRepoPanel: () => void
  onToggleTheme: () => void
}

function ActivityRail({
  themeMode,
  repoPanelOpen,
  onToggleRepoPanel,
  onToggleTheme
}: ActivityRailProps): JSX.Element {
  const { activeView, setActiveView, changeCount } = useActivityRailModel()

  return (
    <nav className={styles['ig-activity-rail']} aria-label="主导航">
      <Tooltip title="仓库" placement="right">
        <button
          className={classNames(styles['ig-rail-item'], repoPanelOpen && styles.active)}
          type="button"
          onClick={onToggleRepoPanel}
          aria-label="仓库"
        >
          <FolderOpenOutlined />
        </button>
      </Tooltip>
      <div className={styles['ig-rail-divider']} />
      {VIEW_OPTIONS.map((item) => {
        const button = (
          <button
            key={item.value}
            className={classNames(
              styles['ig-rail-item'],
              activeView === item.value && styles.active
            )}
            type="button"
            onClick={() => setActiveView(item.value)}
            aria-label={item.label}
          >
            {item.icon}
          </button>
        )

        return (
          <Tooltip key={item.value} title={item.label} placement="right">
            {item.value === 'changes' ? (
              <Badge size="small" count={changeCount} overflowCount={99} offset={[-2, 4]}>
                {button}
              </Badge>
            ) : (
              button
            )}
          </Tooltip>
        )
      })}
      <div className={styles['ig-rail-spacer']} />
      <Tooltip title={themeMode === 'dark' ? '切换到白天模式' : '切换到黑夜模式'} placement="right">
        <button
          className={styles['ig-rail-item']}
          type="button"
          onClick={onToggleTheme}
          aria-label="切换主题"
        >
          {themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
        </button>
      </Tooltip>
    </nav>
  )
}

export default ActivityRail
