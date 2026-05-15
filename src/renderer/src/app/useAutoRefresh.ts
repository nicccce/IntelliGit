import { useEffect, useRef } from 'react'

const AUTO_REFRESH_INTERVAL = 1000

export function useAutoRefresh(
  repoPath: string | undefined,
  refreshAllLocal: () => Promise<void>
): void {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (repoPath) {
      timerRef.current = setInterval(() => {
        refreshAllLocal()
      }, AUTO_REFRESH_INTERVAL)
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [repoPath, refreshAllLocal])
}
