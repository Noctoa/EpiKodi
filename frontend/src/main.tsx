import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AudioPlayerProvider } from './player/AudioPlayerContext'
import { restoreThemeEarly, ThemeProvider } from './theme'
import { restoreTvModeEarly, TvModeProvider } from './tvmode'
import './styles/global.css'
import './styles/surfaces.css'

// Avant le premier rendu : évite un passage visible du sombre au clair, ou du bureau au salon
restoreThemeEarly()
restoreTvModeEarly()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <TvModeProvider>
        <AudioPlayerProvider>
          <App />
        </AudioPlayerProvider>
      </TvModeProvider>
    </ThemeProvider>
  </React.StrictMode>
)
