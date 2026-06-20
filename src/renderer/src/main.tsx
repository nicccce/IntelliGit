import './polyfills/process'
import 'antd/dist/reset.css'
import './assets/styles/index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const rootElement = document.getElementById('root')

function renderFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error && error.stack ? error.stack : ''

  if (!rootElement) return

  rootElement.innerHTML = `
    <div style="height:100%;padding:24px;background:#0f1218;color:#e8edf4;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:auto;">
      <h1 style="margin:0 0 12px;font-size:18px;color:#ff7875;">渲染进程启动失败</h1>
      <p style="margin:0 0 16px;color:#a6b0bf;">应用界面加载时发生错误，请把下面的信息发给开发者定位。</p>
      <pre style="white-space:pre-wrap;padding:12px;border:1px solid #3a4554;border-radius:8px;background:#161b22;color:#e8edf4;">${message}\n\n${stack}</pre>
    </div>
  `
}

window.addEventListener('error', (event) => {
  renderFatalError(event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  renderFatalError(event.reason)
})

if (rootElement) {
  try {
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>
    )
  } catch (error) {
    renderFatalError(error)
  }
}
