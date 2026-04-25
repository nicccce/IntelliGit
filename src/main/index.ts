/**
 * @file Electron 主进程入口
 * @description 负责应用生命周期管理、窗口创建、Sidecar 进程启动与 IPC 注册。
 */

import { app, shell, BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { dirname, join, parse } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { SidecarManager } from './core'
import { registerAllIpcHandlers } from './ipc'

// ─── 全局单例 ──────────────────────────────────────────────────────────────────

const sidecarManager = new SidecarManager()

function findGitRoot(startDir: string): string | null {
  let current = startDir
  while (true) {
    if (existsSync(join(current, '.git'))) {
      return current
    }

    const parent = dirname(current)
    if (parent === current) {
      return null
    }

    current = parent
  }
}

function getInitialRepoPath(): string | null {
  const candidates = [
    process.cwd(),
    app.getAppPath(),
    dirname(app.getAppPath()),
    parse(app.getAppPath()).root
  ]

  for (const candidate of candidates) {
    const gitRoot = findGitRoot(candidate)
    if (gitRoot) return gitRoot
  }

  return null
}

// ─── 窗口创建 ──────────────────────────────────────────────────────────────────

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer based on electron-vite cli
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── 应用生命周期 ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.intelligit.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 1. 启动 Sidecar 进程
  //    注意：如果 resources/ 目录下没有编译好的 Go 二进制文件，
  //    SidecarManager 会输出错误日志但不会阻止应用启动。
  try {
    sidecarManager.start()
  } catch (err) {
    console.error('[Main] Sidecar 启动失败（可能尚未编译 Go 二进制）:', err)
  }

  // 2. 注册 IPC Handlers
  registerAllIpcHandlers(sidecarManager)

  // 3. 尝试自动定位当前 Git 仓库，让前端能够直接读取状态
  const projectRoot = getInitialRepoPath()
  if (projectRoot) {
    void sidecarManager
      .send('repo.open', { path: projectRoot })
      .then((response) => {
        if (!response.success) {
          console.warn('[Main] 自动打开仓库失败:', response.error)
        } else {
          console.log('[Main] 自动打开仓库成功:', projectRoot)
        }
      })
      .catch((err) => {
        console.warn('[Main] 自动打开仓库请求失败:', err instanceof Error ? err.message : String(err))
      })
  } else {
    console.warn('[Main] 未找到可用 Git 仓库根目录，稍后需要手动打开仓库')
  }

  // 4. 创建窗口
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 应用退出前清理 Sidecar 进程
app.on('before-quit', () => {
  sidecarManager.stop()
})
