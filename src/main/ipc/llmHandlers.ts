import { ipcMain } from 'electron'

import { IPC_CHANNELS, type LlmProxyRequest, type LlmProxyResponse } from '../../shared/types'

const LLM_PROXY_TIMEOUT_MS = 30_000

function sanitizeLlmError(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
}

/**
 * 主进程代理 LLM HTTP 请求，避免 renderer 直接跨域请求模型 API 导致 Failed to fetch。
 */
export function registerLlmHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.LLM_PROXY,
    async (_event, request: LlmProxyRequest): Promise<LlmProxyResponse> => {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), LLM_PROXY_TIMEOUT_MS)

      try {
        const response = await fetch(request.url, {
          method: 'POST',
          headers: request.headers,
          body: request.body,
          signal: controller.signal
        })

        const text = await response.text()

        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          body: response.ok ? text : sanitizeLlmError(text)
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return {
            ok: false,
            status: 408,
            statusText: 'Request Timeout',
            body: 'LLM 请求超时'
          }
        }

        return {
          ok: false,
          status: 0,
          statusText: 'Network Error',
          body: err instanceof Error ? sanitizeLlmError(err.message) : sanitizeLlmError(String(err))
        }
      } finally {
        clearTimeout(timeout)
      }
    }
  )
}
