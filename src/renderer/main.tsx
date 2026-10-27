import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '@fontsource/barlow-condensed/700.css'
import '@fontsource/barlow-condensed/800.css'
import '@fontsource/barlow-condensed/900.css'
import '@fontsource/dm-mono/400.css'
import './overdrive.css'
import './overdrive-reference.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
