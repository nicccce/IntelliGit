import MainApp from './MainApp'
import SidecarTestPanel from './dev/SidecarTestPanel'

function App(): React.JSX.Element {
  return window.electronAPI.mode === 'test' ? <SidecarTestPanel /> : <MainApp />
}

export default App
