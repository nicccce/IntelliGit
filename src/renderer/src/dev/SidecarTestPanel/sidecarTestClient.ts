import type { SidecarResponse } from '../../../../shared/types'

export function invokeRawSidecarCommand(
  command: string,
  payload?: Record<string, unknown>
): Promise<SidecarResponse> {
  return window.electronAPI.invokeGit(command, payload)
}
