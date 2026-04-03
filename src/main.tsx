/**
 * Application entry point.
 *
 * The yFiles license is initialised here, before React mounts,
 * so it is set before any GraphComponent is created.
 *
 * If the yFiles package or license.json is missing, the app still renders —
 * the error is caught inside useGraphComponent and shown as an ErrorBanner.
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Attempt to initialise the yFiles license.
// Errors are surfaced at render time through the hook, not here,
// so we do NOT await or block rendering on this call.
import('./yfiles/license-init')
  .then(({ initLicense }) => initLicense())
  .catch(() => {
    // Swallow — useGraphComponent will surface the error in the UI
  })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
