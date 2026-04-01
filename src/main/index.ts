/**
 * @file Electron 主进程入口
 * @description 负责应用生命周期管理、窗口创建、Sidecar 进程启动与 IPC 注册。
 */

import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { SidecarManager } from './core'
import { registerAllIpcHandlers } from './ipc'

// ─── 全局单例 ──────────────────────────────────────────────────────────────────

const sidecarManager = new SidecarManager()

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

  // 3. 创建窗口
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
