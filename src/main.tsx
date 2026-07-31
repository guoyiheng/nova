import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/manrope'
import '@fontsource-variable/newsreader'
import './styles.css'
import { App } from './App'

function RendererReady() {
  React.useEffect(() => {
    void window.nova.rendererReady().catch(() => undefined)
  }, [])
  return null
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <RendererReady />
  </React.StrictMode>,
)
