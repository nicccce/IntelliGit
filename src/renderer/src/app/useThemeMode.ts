import { useCallback, useEffect, useState } from 'react'

import type { AppThemeMode } from './types'

export function useThemeMode(): {
  themeMode: AppThemeMode
  toggleTheme: () => void
} {
  const [themeMode, setThemeMode] = useState<AppThemeMode>(() => {
    const saved = window.localStorage.getItem('intelligit.theme')
    return saved === 'light' || saved === 'dark' ? saved : 'dark'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    document.body.dataset.theme = themeMode
    window.localStorage.setItem('intelligit.theme', themeMode)
  }, [themeMode])

  const toggleTheme = useCallback(() => {
    setThemeMode((mode) => (mode === 'dark' ? 'light' : 'dark'))
  }, [])

  return { themeMode, toggleTheme }
}
