import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { JungleWidget } from './Jungle'
import '@fontsource/barlow-condensed/700.css'
import '@fontsource/barlow-condensed/800.css'
import '@fontsource/dm-mono/400.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.hash === '#jungle' ? <JungleWidget /> : <App />}
  </React.StrictMode>,
)
