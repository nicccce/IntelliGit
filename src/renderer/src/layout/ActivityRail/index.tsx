import type { JSX } from 'react'
import { Badge, Tooltip } from 'antd'
import {
  FolderOpenOutlined,
  MessageOutlined,
  MoonOutlined,
  SettingOutlined,
  SunOutlined
} from '@ant-design/icons'
import type { AppThemeMode, SidePanel } from '../../app/types'
import { VIEW_OPTIONS } from '../../app/viewOptions'
import { classNames } from '../../utils/classNames'
import { useActivityRailModel } from '../../viewModels'
import styles from './ActivityRail.module.css'

interface ActivityRailProps {
  themeMode: AppThemeMode
  activeSidePanel: SidePanel
  onToggleSidePanel: (panel: SidePanel) => void
  onToggleTheme: () => void
}

interface RailButtonProps {
  icon: React.ReactNode
  label: string
  isActive: boolean
  onClick: () => void
  badge?: number
}

function RailButton({ icon, label, isActive, onClick, badge }: RailButtonProps): JSX.Element {
        const button = (
          <button
      className={classNames(styles['ig-rail-item'], isActive && styles.active)}
            type="button"
      onClick={onClick}
      aria-label={label}
          >
      {icon}
          </button>
        )

        return (
    <Tooltip title={label} placement="right">
      {badge !== undefined ? (
        <Badge size="small" count={badge} overflowCount={99} offset={[-2, 4]}>
                {button}
              </Badge>
            ) : (
              button
            )}
          </Tooltip>
        )
}

function ActivityRail({
  themeMode,
  activeSidePanel,
  onToggleSidePanel,
  onToggleTheme
}: ActivityRailProps): JSX.Element {
  const { activeView, setActiveView, changeCount } = useActivityRailModel()

  return (
    <nav className={styles['ig-activity-rail']} aria-label="主导航">
      {/* 仓库面板 */}
      <RailButton
        icon={<FolderOpenOutlined />}
        label="仓库"
        isActive={activeSidePanel === 'repo'}
        onClick={() => onToggleSidePanel('repo')}
      />
      {/* 对话面板 */}
      <RailButton
        icon={<MessageOutlined />}
        label="对话"
        isActive={activeSidePanel === 'chat'}
        onClick={() => onToggleSidePanel('chat')}
      />
      {/* 全局设置面板 */}
      <RailButton
        icon={<SettingOutlined />}
        label="设置"
        isActive={activeSidePanel === 'settings'}
        onClick={() => onToggleSidePanel('settings')}
      />

      <div className={styles['ig-rail-divider']} />

      {/* 主视图按钮（变更/历史/配置） */}
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

      {/* 主题切换 */}
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

