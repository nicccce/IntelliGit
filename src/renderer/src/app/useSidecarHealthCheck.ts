import { useEffect, useRef } from 'react'

import { checkSidecarHealth } from '../services/sidecarHealthService'

const SIDECAR_HEALTH_INTERVAL_MS = 5000

export function useSidecarHealthCheck(): void {
  const inFlightRef = useRef(false)

  useEffect(() => {
    let active = true

    const runCheck = async (): Promise<void> => {
      if (!active || inFlightRef.current) return

      inFlightRef.current = true
      try {
        await checkSidecarHealth()
      } finally {
        inFlightRef.current = false
      }
    }

    void runCheck()
    const timer = setInterval(() => {
      void runCheck()
    }, SIDECAR_HEALTH_INTERVAL_MS)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
}
