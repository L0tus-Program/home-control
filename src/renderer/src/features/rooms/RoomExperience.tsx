import { useEffect, useMemo, useRef, useState } from 'react'
import type { Command, Device } from '../../../../shared/types'
import { DeviceControlModal } from '../../components/DeviceControlModal'
import { RefreshIcon, SettingsIcon } from '../../components/Icons'
import { modeLabel } from '../../labels'

interface Props {
  devices: Device[]
  loading: boolean
  pending: ReadonlySet<string>
  error: string | null
  connected: boolean
  onRefresh: () => void
  onOpenSettings: () => void
  onCommand: (device: Device, command: Command) => void
}

type RoomView = 'iso' | 'top'

interface Placement {
  x: number
  y: number
  scale: number
  role: 'floor-lamp' | 'desk-light' | 'ac' | 'unknown'
}

function deviceKey(device: Device): string {
  return `${device.driverId}:${device.id}`
}

function hash(input: string): number {
  let value = 0
  for (const char of input) value = (value * 31 + char.charCodeAt(0)) | 0
  return Math.abs(value)
}

function placementFor(device: Device, index: number, total: number): Placement {
  if (device.kind === 'air-conditioner') return { x: 66, y: 21, scale: 1, role: 'ac' }
  const seed = hash(deviceKey(device))
  const fallback = total <= 1 ? 0.5 : index / Math.max(total - 1, 1)
  return {
    x: 28 + ((seed % 38) || fallback * 38),
    y: 39 + (((seed >> 4) % 32) || fallback * 28),
    scale: 0.92 + ((seed % 5) * 0.035),
    role: index % 2 === 0 ? 'floor-lamp' : 'desk-light'
  }
}

function lightColor(device: Device): string {
  const color = device.state.color
  if (!color) return '#ffd79a'
  return `hsl(${color.hue}, ${Math.max(45, color.saturation)}%, 66%)`
}

function deviceStatus(device: Device): string {
  if (device.driverId === 'tuya' && !device.state.online) return 'Offline'
  if (!device.state.power) return 'Desligado'
  if (device.kind === 'air-conditioner') {
    const temp = device.state.temperature ? ` · ${Math.round(device.state.temperature)}°C` : ''
    return `${device.state.mode ? modeLabel(device.state.mode) : 'Ligado'}${temp}`
  }
  if (device.kind === 'light') return `${Math.round(device.state.brightness ?? 100)}%`
  return 'Ligado'
}

function SceneDevice({ device, placement, selected, onSelect }: { device: Device; placement: Placement; selected: boolean; onSelect: () => void }): React.JSX.Element {
  const isOn = device.state.power && !(device.driverId === 'tuya' && !device.state.online)
  const color = lightColor(device)
  const style = {
    left: `${placement.x}%`,
    top: `${placement.y}%`,
    transform: `translate(-50%, -50%) scale(${placement.scale})`,
    '--device-glow': color
  } as React.CSSProperties

  if (placement.role === 'ac') {
    return (
      <button type="button" className={`room-object room-object--ac${selected ? ' is-selected' : ''}${isOn ? ' is-on' : ''}`}
        style={style} onClick={onSelect} aria-label={`Abrir controles de ${device.name}`}>
        <span className="ac-unit"><span /><span /><span /></span>
        <span className="cold-wash" aria-hidden="true" />
        <span className="room-object__label">{device.name}</span>
      </button>
    )
  }

  return (
    <button type="button" className={`room-object room-object--light ${placement.role === 'desk-light' ? 'room-object--desk' : 'room-object--floor'}${selected ? ' is-selected' : ''}${isOn ? ' is-on' : ''}`}
      style={style} onClick={onSelect} aria-label={`Abrir controles de ${device.name}`}>
      <span className="light-halo" aria-hidden="true" />
      <span className="lamp-shade" />
      <span className="lamp-stem" />
      <span className="lamp-base" />
      <span className="room-object__label">{device.name}</span>
    </button>
  )
}

export function RoomExperience({ devices, loading, pending, error, connected, onRefresh, onOpenSettings, onCommand }: Props): React.JSX.Element {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [view, setView] = useState<RoomView>('iso')
  const [editMode, setEditMode] = useState(false)
  const [roomName, setRoomName] = useState('Sala viva')
  const previousCount = useRef(devices.length)

  const devicesByKey = useMemo(() => new Map(devices.map((device) => [deviceKey(device), device])), [devices])
  const selectedDevice = selectedKey ? devicesByKey.get(selectedKey) : undefined
  const lights = devices.filter((device) => device.kind === 'light')
  const acs = devices.filter((device) => device.kind === 'air-conditioner')
  const onlineCount = devices.filter((device) => device.driverId !== 'tuya' || device.state.online).length
  const onCount = devices.filter((device) => device.state.power).length
  const ambientTemp = acs.find((device) => device.state.currentTemperature !== undefined)?.state.currentTemperature
    ?? acs.find((device) => device.state.temperature !== undefined)?.state.temperature

  useEffect(() => {
    if (previousCount.current === 0 && devices.length > 0) setSelectedKey(deviceKey(devices[0]))
    previousCount.current = devices.length
  }, [devices])

  useEffect(() => {
    if (selectedKey && !devicesByKey.has(selectedKey)) setSelectedKey(null)
  }, [devicesByKey, selectedKey])

  const placements = useMemo(() => {
    const map = new Map<string, Placement>()
    devices.forEach((device, index) => map.set(deviceKey(device), placementFor(device, index, devices.length)))
    return map
  }, [devices])

  return (
    <section className="rooms-page" aria-label="Cômodo 3D">
      <div className="rooms-hero">
        <div>
          <div className="content__integration">Cômodos 3D</div>
          <h1>{roomName}, em outra dimensão.</h1>
          <p>Uma maquete isométrica da sua casa real: clique em cada aparelho para abrir controles LG e Tuya em um modal.</p>
        </div>
        <div className="rooms-hero__actions">
          <button type="button" className="btn btn--ghost" disabled={loading || !connected} onClick={onRefresh}>
            <RefreshIcon />{loading ? 'Atualizando…' : 'Atualizar casa'}
          </button>
          <button type="button" className={`btn${editMode ? ' btn--primary' : ''}`} onClick={() => setEditMode((value) => !value)}>
            {editMode ? 'Concluir edição' : 'Editar cômodo'}
          </button>
        </div>
      </div>

      {error && <div className="alert room-alert" role="alert"><span>{error}</span></div>}

      <div className="room-tabs" aria-label="Cômodos">
        <button type="button" className="room-tab is-active"><span>Sala viva</span><small>{devices.length}</small></button>
        <button type="button" className="room-tab" disabled><span>Quarto</span><small>em breve</small></button>
        <button type="button" className="room-tab" disabled><span>Cozinha</span><small>em breve</small></button>
      </div>

      <div className="room-layout">
        <div className="room-stage-card">
          <div className="room-stage-card__meta">
            <div>
              <span className="modal__kicker"><span>Casa conectada</span><span>{connected ? `${onlineCount}/${devices.length || 0} disponíveis` : 'Integrações pendentes'}</span></span>
              <h2>{roomName}</h2>
              <p>{devices.length ? `${devices.length} aparelhos · ${onCount} ligados` : 'Conecte LG e Tuya para povoar o cômodo.'}</p>
            </div>
            <div className="room-weather" aria-label="Temperatura ambiente">
              <strong>{ambientTemp !== undefined ? `${Math.round(ambientTemp)}°C` : '—'}</strong>
              <span>ambiente</span>
            </div>
          </div>

          <div className={`room-stage room-stage--${view}`}>
            <div className="room-scene" role="img" aria-label={`Maquete de ${roomName} com aparelhos clicáveis`}>
              <div className="room-shadow" />
              <div className="room-floor">
                <span className="rug" />
                <span className="sofa"><i /><i /><i /></span>
                <span className="coffee-table" />
                <span className="plant"><i /><i /><i /></span>
                <span className="wall wall--back" />
                <span className="wall wall--left" />
                <span className="window-light" />
                {devices.map((device) => {
                  const key = deviceKey(device)
                  const placement = placements.get(key)
                  if (!placement) return null
                  return <SceneDevice key={key} device={device} placement={placement} selected={selectedKey === key}
                    onSelect={() => setSelectedKey(key)} />
                })}
                {!devices.length && (
                  <div className="empty-room-callout">
                    <strong>Sua maquete está pronta.</strong>
                    <span>Conecte as integrações para posicionar lâmpadas e ar-condicionado.</span>
                    <button type="button" className="btn btn--primary" onClick={onOpenSettings}><SettingsIcon size={15} />Abrir preferências</button>
                  </div>
                )}
              </div>
            </div>
            <div className="room-toolbar" aria-label="Controles da maquete">
              <button type="button" className={view === 'iso' ? 'is-active' : undefined} onClick={() => setView('iso')}>Perspectiva</button>
              <button type="button" className={view === 'top' ? 'is-active' : undefined} onClick={() => setView('top')}>Planta</button>
              <button type="button" onClick={() => setSelectedKey(devices[0] ? deviceKey(devices[0]) : null)}>Focar</button>
            </div>
            <div className="room-hint"><span>Clique em um aparelho</span> para abrir o modal · A lista ao lado também controla tudo por teclado</div>
          </div>
        </div>

        <aside className="room-panel" aria-label="Aparelhos do cômodo">
          {editMode ? (
            <div className="room-editor">
              <div className="modal__kicker"><span>Modo edição</span><span>visual</span></div>
              <label className="field">Nome do cômodo<input value={roomName} maxLength={32} onChange={(event) => setRoomName(event.target.value)} /></label>
              <p>Esta primeira versão cria a composição automaticamente a partir dos aparelhos encontrados. O próximo passo é salvar posições livres.</p>
              <div className="room-palette">
                <span>{lights.length} luzes</span><span>{acs.length} ar-condicionado</span><span>móveis decorativos</span>
              </div>
            </div>
          ) : (
            <>
              <div className="room-panel__head">
                <div><span className="content__integration">Dispositivos</span><h3>Toque para controlar</h3></div>
                <span>{devices.length}</span>
              </div>
              <div className="room-device-list">
                {devices.map((device) => {
                  const key = deviceKey(device)
                  return (
                    <button key={key} type="button" className={selectedKey === key ? 'is-selected' : undefined} onClick={() => setSelectedKey(key)}>
                      <span className={`device-dot device-dot--${device.kind}`} style={{ '--device-glow': lightColor(device) } as React.CSSProperties} />
                      <span><strong>{device.name}</strong><small>{deviceStatus(device)}</small></span>
                    </button>
                  )
                })}
                {!devices.length && <p className="room-panel__empty">Nenhum aparelho carregado para exibir neste cômodo.</p>}
              </div>
            </>
          )}
        </aside>
      </div>

      {selectedDevice && !editMode && (
        <DeviceControlModal device={selectedDevice} busy={pending.has(deviceKey(selectedDevice))} onClose={() => setSelectedKey(null)}
          onCommand={(command) => onCommand(selectedDevice, command)} />
      )}
    </section>
  )
}
