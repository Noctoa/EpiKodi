import type { PluginMenuGroup } from '@shared/ipc'
import { SECTIONS, activeKey, menuKey, type SectionName, type View } from '@frontend/navigation'
import { useProfiles } from '@frontend/profiles'
import { ProfileAvatar } from './ProfilePicker'
import './Sidebar.css'

/** Sections de gestion, sous « Mon espace » ; les autres servent à explorer la bibliothèque. */
const PERSONAL = new Set<string>(['stats', 'sources', 'settings'])

interface Props {
  view: View
  counts: Partial<Record<SectionName, number>>
  /** Entrées apportées par les extensions actives, à la suite des sections intégrées */
  pluginMenus: PluginMenuGroup[]
  onNavigate: (view: View) => void
}

export function Sidebar({ view, counts, pluginMenus, onNavigate }: Props): React.JSX.Element {
  const active = activeKey(view)
  const { active: profile, openPicker } = useProfiles()
  const entry = (key: string, icon: string, label: string, count?: number): React.JSX.Element => (
    <li key={key}>
      <button
        className={`sidebar__item ${key === active ? 'sidebar__item--active' : ''}`}
        onClick={() => onNavigate(viewFor(key))}
        aria-current={key === active ? 'page' : undefined}
        // En mode TV le libellé est masqué : sans ce titre, le bouton n'aurait plus de nom
        title={label}
      >
        <span className="sidebar__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="sidebar__label">{label}</span>
        {count !== undefined && <span className="sidebar__count">{count}</span>}
      </button>
    </li>
  )

  /** Les entrées d'extension sont identifiées par leur clé ; les sections, par leur nom. */
  function viewFor(key: string): View {
    for (const group of pluginMenus) {
      for (const item of group.menu) {
        if (menuKey(group.pluginId, item.id) === key) {
          return {
            name: 'plugin',
            pluginId: group.pluginId,
            menuId: item.id,
            title: item.label
          }
        }
      }
    }
    return { name: key } as View
  }

  return (
    <nav className="sidebar" aria-label="Navigation principale">
      {profile && (
        <button
          className="sidebar__profile"
          onClick={() => openPicker()}
          title={`${profile.name} — changer de profil`}
        >
          <ProfileAvatar profile={profile} size="md" />
          <span className="sidebar__profile-name">{profile.name}</span>
          <span className="sidebar__profile-switch" aria-hidden="true">
            ⇄
          </span>
        </button>
      )}
      <p className="sidebar__heading">
        EXPLORER <span aria-hidden="true">↘</span>
      </p>
      <ul>
        {SECTIONS.filter((s) => !PERSONAL.has(s.name)).map((s) =>
          entry(s.name, s.icon, s.label, counts[s.name])
        )}
      </ul>

      <p className="sidebar__heading sidebar__heading--manage">MON ESPACE</p>
      <ul>
        {SECTIONS.filter((s) => PERSONAL.has(s.name)).map((s) =>
          entry(s.name, s.icon, s.label, counts[s.name])
        )}
      </ul>

      {pluginMenus.length > 0 && (
        <ul className="sidebar__plugins">
          {pluginMenus.flatMap((group) =>
            group.menu.map((item) =>
              entry(menuKey(group.pluginId, item.id), item.icon ?? '⬚', item.label)
            )
          )}
        </ul>
      )}
    </nav>
  )
}
