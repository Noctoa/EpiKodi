import type { PluginMenuGroup } from '@shared/ipc'
import { SECTIONS, activeKey, menuKey, type SectionName, type View } from '@frontend/navigation'
import './Sidebar.css'

interface Props {
  view: View
  counts: Partial<Record<SectionName, number>>
  /** Entrées apportées par les extensions actives, à la suite des sections intégrées */
  pluginMenus: PluginMenuGroup[]
  onNavigate: (view: View) => void
}

export function Sidebar({ view, counts, pluginMenus, onNavigate }: Props): React.JSX.Element {
  const active = activeKey(view)
  const entry = (key: string, icon: string, label: string, count?: number): React.JSX.Element => (
    <li key={key}>
      <button
        className={`sidebar__item ${key === active ? 'sidebar__item--active' : ''}`}
        onClick={() => onNavigate(viewFor(key))}
        aria-current={key === active ? 'page' : undefined}
        // En mode TV le libellé est masqué : sans ce titre, le bouton n'aurait plus de nom
        title={label}
      >
        <span className="sidebar__icon">{icon}</span>
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
      <ul>{SECTIONS.map((s) => entry(s.name, s.icon, s.label, counts[s.name]))}</ul>

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
