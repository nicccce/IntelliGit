import type { SidecarHealthStoreState } from '../sidecarHealthStore'

export const selectSidecarHealthStatus = (
  state: SidecarHealthStoreState
): SidecarHealthStoreState['status'] => state.status

export const selectSidecarHealthError = (state: SidecarHealthStoreState): string | null =>
  state.error

export const selectSidecarLatencyMs = (state: SidecarHealthStoreState): number | null =>
  state.latencyMs

export const selectSidecarProtocolVersion = (state: SidecarHealthStoreState): number | null =>
  state.protocolVersion
