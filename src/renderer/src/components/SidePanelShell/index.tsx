import type { JSX, MouseEvent as ReactMouseEvent } from 'react'
import { useCallback } from 'react'
import { Button } from 'antd'
import { CloseOutlined } from '@ant-design/icons'

import { useUiStore } from '../../store'
import { selectSetSidePanelWidth, selectSidePanelWidth } from '../../store/selectors'
import styles from './SidePanelShell.module.css'

interface SidePanelShellProps {
  /** 面板标题 */
  title: string
  /** 是否打开 */
  isOpen: boolean
  /** 关闭回调 */
  onClose: () => void
  /** 子内容 */
  children: React.ReactNode
  /** 最小宽度 */
  minWidth?: number
  /** 最大宽度 */
  maxWidth?: number
}

function SidePanelShell({
  title,
  isOpen,
  onClose,
  children,
  minWidth = 200,
  maxWidth = 520
}: SidePanelShellProps): JSX.Element | null {
  const panelWidth = useUiStore(selectSidePanelWidth)
  const setPanelWidth = useUiStore(selectSetSidePanelWidth)

  const handleResizeMouseDown = useCallback(
    (event: ReactMouseEvent): void => {
      event.preventDefault()
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'

      const onMouseMove = (moveEvent: MouseEvent): void => {
        const newWidth = Math.max(minWidth, Math.min(maxWidth, moveEvent.clientX - 52))
        setPanelWidth(newWidth)
      }

      const onMouseUp = (): void => {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    },
    [minWidth, maxWidth, setPanelWidth]
  )

  if (!isOpen) return null

  return (
    <aside className={styles['ig-side-panel']} aria-label={title} style={{ width: panelWidth }}>
      <div className={styles['ig-panel-header']}>
        <h3>{title}</h3>
        <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
      </div>
      <div className={styles['ig-panel-resize-handle']} onMouseDown={handleResizeMouseDown} />
      <div className={styles['ig-panel-body']}>{children}</div>
    </aside>
  )
}

export default SidePanelShell
