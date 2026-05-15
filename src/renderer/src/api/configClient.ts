import type { AppConfig } from '../../../shared/types'

export function loadConfig(): Promise<AppConfig> {
  return window.electronAPI.loadConfig()
}

export function saveConfig(config: AppConfig): Promise<void> {
  return window.electronAPI.saveConfig(config)
}
