import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AudioPlayerProvider } from './player/AudioPlayerContext'
import { restoreThemeEarly, ThemeProvider } from './theme'
import './styles/global.css'

// Avant le premier rendu : évite un passage visible du sombre au clair au démarrage
restoreThemeEarly()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AudioPlayerProvider>
        <App />
      </AudioPlayerProvider>
    </ThemeProvider>
  </React.StrictMode>
)
