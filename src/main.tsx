/**
 * Application entry point.
 *
 * The yFiles license MUST be set before any GraphComponent is created.
 * We await initLicense() before mounting React to guarantee ordering.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initLicense } from './yfiles/license-init'

async function bootstrap() {
  try {
    await initLicense()
  } catch (err) {
    // Show a plain error screen if the license can't be loaded
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <div style={{ padding: '2rem', fontFamily: 'monospace', color: '#c00' }}>
        <h2>License setup required</h2>
        <pre style={{ whiteSpace: 'pre-wrap', marginTop: '1rem' }}>
          {err instanceof Error ? err.message : String(err)}
        </pre>
      </div>
    )
    return
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

bootstrap()
