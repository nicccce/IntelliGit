import MainApp from './app/MainApp'
import SidecarTestPanel from './dev/SidecarTestPanel'

function MissingElectronApiScreen(): React.JSX.Element {
  return (
    <div
      style={{
        minHeight: '100vh',
        padding: 24,
        background: '#0f1218',
        color: '#e8edf4',
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      }}
    >
      <h1 style={{ margin: '0 0 12px', fontSize: 18, color: '#ff7875' }}>预加载 API 未就绪</h1>
      <p style={{ margin: 0, color: '#a6b0bf', lineHeight: 1.7 }}>
        当前页面没有检测到 Electron preload 暴露的 window.electronAPI。请确认应用是通过 Electron
        启动，而不是直接在浏览器中打开渲染页面；如果是开发模式，请重启开发服务。
      </p>
    </div>
  )
}

function App(): React.JSX.Element {
  if (!window.electronAPI) return <MissingElectronApiScreen />

  return window.electronAPI.mode === 'test' ? <SidecarTestPanel /> : <MainApp />
}

export default App
