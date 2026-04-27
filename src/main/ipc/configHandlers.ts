/**
 * @file Config & Dialog IPC Handlers
 * @description 处理应用配置的持久化读写和系统文件夹选择对话框。
 *              配置文件保存在 app.getPath('userData') 下的 intelligit-config.json。
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'fs'
import { IPC_CHANNELS, type AppConfig } from '../../shared/types'

/** 配置文件路径 */
const CONFIG_FILE_PATH = join(app.getPath('userData'), 'intelligit-config.json')

/** 默认配置 */
const DEFAULT_CONFIG: AppConfig = {
  repos: [],
  currentRepoPath: null
}

/** 读取配置文件 */
function loadConfig(): AppConfig {
  try {
    if (existsSync(CONFIG_FILE_PATH)) {
      const raw = readFileSync(CONFIG_FILE_PATH, 'utf-8')
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) }
    }
  } catch (err) {
    console.error('[Config] 读取配置失败:', err)
  }
  return { ...DEFAULT_CONFIG }
}

/** 保存配置文件 */
function saveConfig(config: AppConfig): void {
  try {
    writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2), 'utf-8')
    console.log('[Config] 配置已保存到:', CONFIG_FILE_PATH)
  } catch (err) {
    console.error('[Config] 保存配置失败:', err)
    throw err
  }
}

/**
 * 注册配置和对话框相关的 IPC 处理器
 */
export function registerConfigHandlers(): void {
  // ── 读取配置 ─────────────────────────────────────────────────────────────
  ipcMain.handle(IPC_CHANNELS.CONFIG_LOAD, async (): Promise<AppConfig> => {
    console.log('[IPC] config:load')
    return loadConfig()
  })

  // ── 保存配置 ─────────────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.CONFIG_SAVE,
    async (_event, config: AppConfig): Promise<void> => {
      console.log('[IPC] config:save', config)
      saveConfig(config)
    }
  )

  // ── 打开文件夹选择对话框 ─────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.DIALOG_OPEN_FOLDER,
    async (): Promise<string | null> => {
      const focusedWindow = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(focusedWindow!, {
        properties: ['openDirectory'],
        title: '选择 Git 仓库目录'
      })
      if (result.canceled || result.filePaths.length === 0) {
        return null
      }
      return result.filePaths[0]
    }
  )

  // ── 检查目录是否存在 ─────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.CHECK_DIR_EXISTS,
    async (_event, path: string): Promise<boolean> => {
      try {
        const stats = statSync(path)
        return stats.isDirectory()
      } catch {
        return false
      }
    }
  )

  // ── 检查目录是否为空 ─────────────────────────────────────────────────────
  ipcMain.handle(
    IPC_CHANNELS.CHECK_DIR_EMPTY,
    async (_event, path: string): Promise<boolean> => {
      try {
        const stats = statSync(path)
        if (!stats.isDirectory()) return false
        const files = readdirSync(path)
        return files.length === 0
      } catch {
        return false
      }
    }
  )
}
