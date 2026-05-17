import { create } from 'zustand'

export type SidecarHealthStatus = 'checking' | 'ready' | 'unavailable'

interface SidecarReadyPayload {
  protocolVersion: number
  latencyMs: number
}

export interface SidecarHealthStoreState {
  status: SidecarHealthStatus
  error: string | null
  lastCheckedAt: number | null
  latencyMs: number | null
  protocolVersion: number | null
  setSidecarChecking: () => void
  setSidecarReady: (payload: SidecarReadyPayload) => void
  setSidecarUnavailable: (error: string) => void
}

const INITIAL_SIDECAR_HEALTH = {
  status: 'checking' as const,
  error: null,
  lastCheckedAt: null,
  latencyMs: null,
  protocolVersion: null
}

export const useSidecarHealthStore = create<SidecarHealthStoreState>((set) => ({
  ...INITIAL_SIDECAR_HEALTH,
  setSidecarChecking: () =>
    set({
      status: 'checking',
      error: null
    }),
  setSidecarReady: ({ protocolVersion, latencyMs }) =>
    set({
      status: 'ready',
      error: null,
      lastCheckedAt: Date.now(),
      latencyMs,
      protocolVersion
    }),
  setSidecarUnavailable: (error) =>
    set({
      status: 'unavailable',
      error,
      lastCheckedAt: Date.now(),
      latencyMs: null,
      protocolVersion: null
    })
}))
