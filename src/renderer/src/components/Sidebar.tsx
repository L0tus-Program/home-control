import type { HomeLayout } from '../../../shared/home'
import type { Device, DriverStatus } from '../../../shared/types'
import type { Integration } from './SettingsModal'
import { PlusIcon, SettingsIcon } from './Icons'

export type AppSection = 'rooms' | Integration

interface Props {
  statuses: DriverStatus[]
  devices: Device[]
  selectedSection: AppSection
  selectedIntegration: Integration
  onSelectSection: (section: AppSection) => void
  onOpenSettings: () => void
  layout: HomeLayout | null
  selectedRoomId: string | null
  onSelectRoom: (roomId: string) => void
  onNewRoom: () => void
  /** Durante a edicao de um comodo a navegacao fica travada ate salvar ou cancelar. */
  locked: boolean
}

const LOCKED_HINT = 'Salve ou cancele a edição do cômodo primeiro.'

function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase()
}

function stateInfo(status: DriverStatus): { text: string; variant: string } {
  if (status.error) return { text: 'Revisar conexão', variant: 'error' }
  if (!status.configured) return { text: 'Conectar conta', variant: 'off' }
  return { text: 'Configurado', variant: 'ok' }
}

export function Sidebar({
  statuses, devices, selectedSection, selectedIntegration, onSelectSection, onOpenSettings,
  layout, selectedRoomId, onSelectRoom, onNewRoom, locked
}: Props): React.JSX.Element {
  const title = locked ? LOCKED_HINT : undefined
  return (
    <aside className="sidebar">
      <nav aria-label="Minha casa">
        <div className="sidebar__title">Minha casa</div>
        {layout ? layout.rooms.map((room) => {
          const current = selectedSection === 'rooms' && room.id === selectedRoomId
          const count = room.items.filter((item) => item.device).length
          return (
            <button key={room.id} type="button" className={`integration${current ? ' integration--selected' : ''}`}
              aria-current={current ? 'page' : undefined} disabled={locked && !current} title={title}
              onClick={() => onSelectRoom(room.id)}>
              <span className="integration__mark" aria-hidden="true">{initials(room.name)}</span>
              <span>
                <span className="integration__name">{room.name}</span>
                <span className="integration__state integration__state--ok">
                  {room.id === layout.baseRoomId ? 'Cômodo base' : 'Cômodo'} · {count} {count === 1 ? 'aparelho' : 'aparelhos'}
                </span>
              </span>
            </button>
          )
        }) : (
          <button type="button" className={`integration${selectedSection === 'rooms' ? ' integration--selected' : ''}`}
            aria-current={selectedSection === 'rooms' ? 'page' : undefined} onClick={() => onSelectSection('rooms')}>
            <span className="integration__mark" aria-hidden="true">3D</span>
            <span>
              <span className="integration__name">Cômodos 3D</span>
              <span className="integration__state integration__state--ok">Maquete interativa · {devices.length}</span>
            </span>
          </button>
        )}
        {layout && (
          <button type="button" className="integration integration--add" disabled={locked} title={title} onClick={onNewRoom}>
            <span className="integration__mark" aria-hidden="true"><PlusIcon size={14} /></span>
            <span className="integration__name">Novo cômodo</span>
          </button>
        )}
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
              disabled={locked} onClick={() => onSelectSection(integration)} title={title ?? status.error}>
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
        <button type="button" className="integration" disabled={locked} title={title} onClick={onOpenSettings}>
          <span className="integration__mark"><SettingsIcon size={15} /></span>
          <span className="integration__name">Preferências {selectedIntegration === 'tuya' ? 'Tuya' : 'LG'}</span>
        </button>
      </div>
    </aside>
  )
}
