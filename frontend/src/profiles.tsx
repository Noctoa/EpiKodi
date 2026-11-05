import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { flushSync } from 'react-dom'
import type { ProfilesState } from '@shared/ipc'
import type { Profile } from '@shared/models'

/**
 * Profils du foyer. Le backend tient le profil actif et filtre dessus toutes les données
 * personnelles ; le frontend se contente de dire lequel choisir, puis de tout recharger.
 */
export interface ProfilesApi {
  profiles: Profile[]
  active: Profile | null
  /** Écran « Qui regarde ? » affiché */
  pickerOpen: boolean
  /** Au démarrage, on ne peut pas fermer l'écran sans choisir */
  mandatory: boolean
  /** Ouvert directement en mode gestion (création, renommage, suppression) */
  managing: boolean
  /** Bascule en cours : l'application est démontée le temps de changer de profil */
  switching: boolean
  openPicker(manage?: boolean): void
  closePicker(): void
  setManaging(managing: boolean): void
  select(id: number): Promise<void>
  create(name: string, avatar: string | null): Promise<void>
  update(id: number, patch: { name?: string; avatar?: string | null }): Promise<void>
  remove(id: number): Promise<void>
}

const Ctx = createContext<ProfilesApi | null>(null)

export function useProfiles(): ProfilesApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useProfiles() hors de <ProfileProvider>')
  return ctx
}

export function ProfileProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<ProfilesState | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [mandatory, setMandatory] = useState(false)
  const [managing, setManaging] = useState(false)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.epikodi.profilesList().then((s) => {
      if (cancelled) return
      setState(s)
      // Seul, on n'a pas à se présenter : l'écran de choix ne s'affiche qu'à plusieurs
      if (s.profiles.length > 1) {
        setPickerOpen(true)
        setMandatory(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const openPicker = useCallback((manage = false) => {
    setManaging(manage)
    setPickerOpen(true)
  }, [])

  const closePicker = useCallback(() => {
    setPickerOpen(false)
    setManaging(false)
    setMandatory(false)
  }, [])

  const select = useCallback(
    async (id: number) => {
      if (!state) return
      if (id === state.activeId) {
        closePicker()
        return
      }
      // L'application est démontée avant la bascule : le lecteur enregistre sa position en
      // partant, et cette écriture doit encore aller à l'ancien profil.
      flushSync(() => setSwitching(true))
      await new Promise((resolve) => setTimeout(resolve, 0))
      try {
        setState(await window.epikodi.profilesSelect(id))
        closePicker()
      } finally {
        setSwitching(false)
      }
    },
    [state, closePicker]
  )

  const create = useCallback(async (name: string, avatar: string | null) => {
    setState(await window.epikodi.profilesCreate(name, avatar))
  }, [])

  const update = useCallback(
    async (id: number, patch: { name?: string; avatar?: string | null }) => {
      setState(await window.epikodi.profilesUpdate(id, patch))
    },
    []
  )

  const remove = useCallback(
    async (id: number) => {
      // Supprimer le profil actif fait basculer sur un autre : même précaution que `select`
      const wasActive = id === state?.activeId
      if (wasActive) flushSync(() => setSwitching(true))
      try {
        setState(await window.epikodi.profilesRemove(id))
      } finally {
        if (wasActive) setSwitching(false)
      }
    },
    [state]
  )

  const value = useMemo<ProfilesApi>(
    () => ({
      profiles: state?.profiles ?? [],
      active: state?.profiles.find((p) => p.id === state.activeId) ?? null,
      pickerOpen,
      mandatory,
      managing,
      switching,
      openPicker,
      closePicker,
      setManaging,
      select,
      create,
      update,
      remove
    }),
    [
      state,
      pickerOpen,
      mandatory,
      managing,
      switching,
      openPicker,
      closePicker,
      select,
      create,
      update,
      remove
    ]
  )

  return <Ctx.Provider value={value}>{state && children}</Ctx.Provider>
}

/** Icônes proposées comme avatar ; stockées sous la forme « icon:<nom> ». */
export const AVATAR_ICONS: Record<string, string> = {
  fox: '🦊',
  panda: '🐼',
  cat: '🐱',
  dog: '🐶',
  frog: '🐸',
  owl: '🦉',
  octopus: '🐙',
  lion: '🦁',
  rocket: '🚀',
  gamepad: '🎮',
  headphones: '🎧',
  clapper: '🎬',
  star: '⭐',
  ghost: '👻',
  robot: '🤖',
  mask: '🎭'
}

/** Teinte stable par profil : deux profils sans avatar restent distinguables. */
export function profileHue(id: number): number {
  return (id * 137) % 360
}
