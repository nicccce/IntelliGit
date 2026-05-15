import type { JSX } from 'react'

import { classNames } from '../../utils/classNames'
import { useStatusBarModel } from '../../viewModels'
import styles from './StatusBar.module.css'

function StatusBar(): JSX.Element {
  const { currentRepo, currentBranch, commitsAhead, commitsBehind, operationLabel } =
    useStatusBarModel()

  return (
    <footer className={styles['ig-statusbar']}>
      <span className={styles['ig-status-item']}>
        <span className={classNames(styles['ig-status-dot'], styles.green)} />
        引擎就绪
      </span>
      <span className={styles['ig-status-item']}>
        <span className={classNames(styles['ig-status-dot'], styles.blue)} />
        API 已连接
      </span>
      <span className={styles['ig-status-path']}>
        {currentRepo ? currentRepo.path : '未选择仓库'}
      </span>
      <span className={styles['ig-status-tail']}>
        {operationLabel ? `正在执行 ${operationLabel}` : `${commitsAhead}↑ ${commitsBehind}↓`}
        {currentBranch ? ` · ${currentBranch}` : ''}
      </span>
    </footer>
  )
}

export default StatusBar
