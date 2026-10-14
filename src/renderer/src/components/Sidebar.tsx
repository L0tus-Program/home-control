import type { Device, DriverStatus } from '../../../shared/types'
import type { Integration } from './SettingsModal'
import { SettingsIcon } from './Icons'

interface Props {
  statuses: DriverStatus[]
  devices: Device[]
  selectedIntegration: Integration
  onSelectIntegration: (integration: Integration) => void
  onOpenSettings: () => void
}

function stateInfo(status: DriverStatus): { text: string; variant: string } {
  if (status.error) return { text: 'Revisar conexão', variant: 'error' }
  if (!status.configured) return { text: 'Conectar conta', variant: 'off' }
  return { text: 'Configurado', variant: 'ok' }
}

export function Sidebar({ statuses, devices, selectedIntegration, onSelectIntegration, onOpenSettings }: Props): React.JSX.Element {
  return (
    <aside className="sidebar">
      <nav aria-label="Integrações">
        <div className="sidebar__title">Integrações</div>
        {statuses.map((status) => {
          const info = stateInfo(status)
          const integration: Integration = status.id === 'thinq' ? 'lg' : 'tuya'
          const count = devices.filter((device) => device.driverId === status.id).length
          return (
            <button key={status.id} type="button"
              className={`integration${selectedIntegration === integration ? ' integration--selected' : ''}`}
              aria-current={selectedIntegration === integration ? 'page' : undefined}
              onClick={() => onSelectIntegration(integration)} title={status.error}>
              <span className="integration__mark" aria-hidden="true">{status.label.slice(0, 2).toUpperCase()}</span>
              <span>
                <span className="integration__name">{status.label}</span>
                <span className={`integration__state integration__state--${info.variant}`}>
                  {info.text}{info.variant === 'ok' && count > 0 ? ` · ${count}` : ''}
                </span>
              </span>
            </button>
          )
        })}
      </nav>
      <div className="sidebar__footer">
        <button type="button" className="integration" onClick={onOpenSettings}>
          <span className="integration__mark"><SettingsIcon size={15} /></span>
          <span className="integration__name">Preferências {selectedIntegration === 'tuya' ? 'Tuya' : 'LG'}</span>
        </button>
      </div>
    </aside>
  )
}
