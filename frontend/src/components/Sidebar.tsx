import { SECTIONS, activeSection, type SectionName, type View } from '@frontend/navigation'
import './Sidebar.css'

interface Props {
  view: View
  counts: Partial<Record<SectionName, number>>
  onNavigate: (section: SectionName) => void
}

export function Sidebar({ view, counts, onNavigate }: Props): React.JSX.Element {
  const active = activeSection(view)
  return (
    <nav className="sidebar" aria-label="Navigation principale">
      <ul>
        {SECTIONS.map((s) => (
          <li key={s.name}>
            <button
              className={`sidebar__item ${s.name === active ? 'sidebar__item--active' : ''}`}
              onClick={() => onNavigate(s.name)}
              aria-current={s.name === active ? 'page' : undefined}
            >
              <span className="sidebar__icon">{s.icon}</span>
              <span className="sidebar__label">{s.label}</span>
              {counts[s.name] !== undefined && (
                <span className="sidebar__count">{counts[s.name]}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
