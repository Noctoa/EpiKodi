import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ProfilePicker } from './components/ProfilePicker'
import { AudioPlayerProvider } from './player/AudioPlayerContext'
import { ProfileProvider, useProfiles } from './profiles'
import { restoreThemeEarly, ThemeProvider } from './theme'
import { restoreTvModeEarly, TvModeProvider } from './tvmode'
import './styles/global.css'
import './styles/surfaces.css'
import './styles/persona.css'

// Avant le premier rendu : évite un passage visible du sombre au clair, ou du bureau au salon
restoreThemeEarly()
restoreTvModeEarly()

/**
 * L'application est remontée à chaque changement de profil : toutes ses données (favoris,
 * reprises, playlists, podcasts) sont rechargées, et la lecture en cours s'arrête plutôt que de
 * continuer sur le compte de quelqu'un d'autre.
 */
function ProfileGate(): React.JSX.Element {
  const { active, pickerOpen, switching } = useProfiles()
  return (
    <>
      {!switching && (
        <AudioPlayerProvider key={active?.id}>
          <App />
        </AudioPlayerProvider>
      )}
      {pickerOpen && <ProfilePicker />}
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ProfileProvider>
      <ThemeProvider>
        <TvModeProvider>
          <ProfileGate />
        </TvModeProvider>
      </ThemeProvider>
    </ProfileProvider>
  </React.StrictMode>
)
