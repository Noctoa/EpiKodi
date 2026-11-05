import { useTheme } from '../theme'

export function ThemeSwitcher(): React.JSX.Element {
  const { list, select, busy, persona } = useTheme()
  return (
    <div className="theme-switcher" role="group" aria-label="Thème Persona" aria-busy={busy}>
      {(['p3', 'p5'] as const).map((id) => (
        <button
          key={id}
          className={`theme-switcher__${id}`}
          aria-label={id === 'p3' ? 'Thème Persona 3 Reload' : 'Thème Persona 5'}
          aria-pressed={persona === id}
          disabled={!list || busy}
          onClick={() => void select(id === 'p3' ? 'persona3' : 'persona5')}
          title={id === 'p3' ? 'Persona 3 Reload' : 'Persona 5'}
        >
          {id.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
