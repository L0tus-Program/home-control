import type { Device, DriverStatus } from '../../../shared/types'
import type { Integration } from './SettingsModal'
import { SettingsIcon } from './Icons'

export type AppSection = 'rooms' | Integration

interface Props {
  statuses: DriverStatus[]
  devices: Device[]
  selectedSection: AppSection
  selectedIntegration: Integration
  onSelectSection: (section: AppSection) => void
  onOpenSettings: () => void
}

function stateInfo(status: DriverStatus): { text: string; variant: string } {
  if (status.error) return { text: 'Revisar conexão', variant: 'error' }
  if (!status.configured) return { text: 'Conectar conta', variant: 'off' }
  return { text: 'Configurado', variant: 'ok' }
}

export function Sidebar({ statuses, devices, selectedSection, selectedIntegration, onSelectSection, onOpenSettings }: Props): React.JSX.Element {
  return (
    <aside className="sidebar">
      <nav aria-label="Minha casa">
        <div className="sidebar__title">Minha casa</div>
        <button type="button" className={`integration${selectedSection === 'rooms' ? ' integration--selected' : ''}`}
          aria-current={selectedSection === 'rooms' ? 'page' : undefined} onClick={() => onSelectSection('rooms')}>
          <span className="integration__mark" aria-hidden="true">3D</span>
          <span>
            <span className="integration__name">Cômodos 3D</span>
            <span className="integration__state integration__state--ok">Maquete interativa · {devices.length}</span>
          </span>
        </button>
      </nav>
      <nav aria-label="Integrações">
        <div className="sidebar__title">Integrações</div>
        {statuses.map((status) => {
          const info = stateInfo(status)
          const integration: Integration = status.id === 'thinq' ? 'lg' : 'tuya'
          const count = devices.filter((device) => device.driverId === status.id).length
          return (
            <button key={status.id} type="button"
              className={`integration${selectedSection === integration ? ' integration--selected' : ''}`}
              aria-current={selectedSection === integration ? 'page' : undefined}
              onClick={() => onSelectSection(integration)} title={status.error}>
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
