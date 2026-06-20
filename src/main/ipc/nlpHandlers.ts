import { app, ipcMain } from 'electron'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { IPC_CHANNELS, type NlpHistoryRecord } from '../../shared/types'

const HISTORY_FILE_PATH = join(app.getPath('home'), '.intelligit', 'nlp-history.json')

function ensureHistoryDir(): void {
  const dir = dirname(HISTORY_FILE_PATH)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function readHistory(): NlpHistoryRecord[] {
  try {
    if (!existsSync(HISTORY_FILE_PATH)) return []
    const raw = readFileSync(HISTORY_FILE_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    console.error('[NLP] 读取历史失败:', err)
    return []
  }
}

function writeHistory(records: NlpHistoryRecord[]): void {
  ensureHistoryDir()
  writeFileSync(HISTORY_FILE_PATH, JSON.stringify(records, null, 2), 'utf-8')
}

export function registerNlpHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.NLP_GET_HISTORY, async (): Promise<NlpHistoryRecord[]> => {
    return readHistory().sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )
  })

  ipcMain.handle(
    IPC_CHANNELS.NLP_APPEND_HISTORY,
    async (_event, record: NlpHistoryRecord): Promise<void> => {
      const records = readHistory()
      records.unshift(record)
      writeHistory(records.slice(0, 200))
    }
  )

  ipcMain.handle(IPC_CHANNELS.NLP_CLEAR_HISTORY, async (): Promise<void> => {
    writeHistory([])
  })
}
