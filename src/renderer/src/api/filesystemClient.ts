export function openFolderDialog(): Promise<string | null> {
  return window.electronAPI.openFolderDialog()
}

export function checkDirExists(path: string): Promise<boolean> {
  return window.electronAPI.checkDirExists(path)
}

export function checkDirEmpty(path: string): Promise<boolean> {
  return window.electronAPI.checkDirEmpty(path)
}
