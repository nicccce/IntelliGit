import { invokeGit } from '../api/gitClient'
import { useSidecarHealthStore } from '../store'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function checkSidecarHealth(): Promise<void> {
  const startedAt = Date.now()

  try {
    const result = await invokeGit('sidecar.ping')
    if (!result.ok) {
      throw new Error('Sidecar ping returned ok=false')
    }

    useSidecarHealthStore.getState().setSidecarReady({
      protocolVersion: result.protocolVersion,
      latencyMs: Date.now() - startedAt
    })
  } catch (error) {
    useSidecarHealthStore.getState().setSidecarUnavailable(getErrorMessage(error))
  }
}
