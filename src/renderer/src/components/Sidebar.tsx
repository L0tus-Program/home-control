import type { Device, DriverStatus } from '../../../shared/types'
import { SettingsIcon } from './Icons'

interface Props {
  statuses: DriverStatus[]
  devices: Device[]
  onOpenSettings: () => void
}

/** Integracoes ainda nao implementadas, listadas para dar o mapa do caminho. */
const PLANNED = [{ id: 'elgin', label: 'Elgin', note: 'em breve' }]

function stateInfo(status: DriverStatus): { text: string; variant: string } {
  if (status.error) return { text: 'com erro', variant: 'error' }
  if (!status.configured) return { text: 'sem token', variant: 'off' }
  return { text: 'conectado', variant: 'ok' }
}

/** Selo de duas letras: as duas primeiras da marca. "LG ThinQ" vira LG, "Elgin" vira EL. */
function mark(label: string): string {
  const [brand = label] = label.trim().split(/\s+/)
  return brand.slice(0, 2).toUpperCase()
}

export function Sidebar({ statuses, devices, onOpenSettings }: Props): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div>
        <div className="sidebar__title">Integracoes</div>

        {statuses.map((status) => {
          const info = stateInfo(status)
          // Cada integracao conta so os aparelhos dela.
          const count = devices.filter((device) => device.driverId === status.id).length
          return (
            <button
              key={status.id}
              type="button"
              className="integration"
              onClick={onOpenSettings}
              title={status.error ?? undefined}
            >
              <span className="integration__mark">{mark(status.label)}</span>
              <span>
                <span className="integration__name">{status.label}</span>
                <span className={`integration__state integration__state--${info.variant}`}>
                  {info.text}
                  {info.variant === 'ok' && count > 0 ? ` · ${count}` : ''}
                </span>
              </span>
            </button>
          )
        })}

        {PLANNED.filter((item) => !statuses.some((status) => status.id === item.id)).map((item) => (
          <div key={item.id} className="integration" style={{ opacity: 0.4, cursor: 'default' }}>
            <span className="integration__mark">{mark(item.label)}</span>
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
