import type { DriverStatus } from '../../../shared/types'
import { SettingsIcon } from './Icons'

interface Props {
  statuses: DriverStatus[]
  deviceCount: number
  onOpenSettings: () => void
}

/** Integracoes ainda nao implementadas, listadas para dar o mapa do caminho. */
const PLANNED = [{ id: 'elgin', label: 'Elgin', note: 'em breve' }]

function stateInfo(status: DriverStatus): { text: string; variant: string } {
  if (status.error) return { text: 'com erro', variant: 'error' }
  if (!status.configured) return { text: 'sem token', variant: 'off' }
  return { text: 'conectado', variant: 'ok' }
}

export function Sidebar({ statuses, deviceCount, onOpenSettings }: Props): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div>
        <div className="sidebar__title">Integracoes</div>

        {statuses.map((status) => {
          const info = stateInfo(status)
          return (
            <button
              key={status.id}
              type="button"
              className="integration"
              onClick={onOpenSettings}
              title={status.error ?? undefined}
            >
              <span className="integration__mark">LG</span>
              <span>
                <span className="integration__name">{status.label}</span>
                <span className={`integration__state integration__state--${info.variant}`}>
                  {info.text}
                  {info.variant === 'ok' && deviceCount > 0 ? ` · ${deviceCount}` : ''}
                </span>
              </span>
            </button>
          )
        })}

        {PLANNED.map((item) => (
          <div key={item.id} className="integration" style={{ opacity: 0.4, cursor: 'default' }}>
            <span className="integration__mark">EL</span>
            <span>
              <span className="integration__name">{item.label}</span>
              <span className="integration__state integration__state--off">{item.note}</span>
            </span>
          </div>
        ))}
      </div>

      <div className="sidebar__footer">
        <button type="button" className="integration" onClick={onOpenSettings}>
          <span className="integration__mark">
            <SettingsIcon size={15} />
          </span>
          <span className="integration__name">Preferencias</span>
        </button>
      </div>
    </aside>
  )
}
