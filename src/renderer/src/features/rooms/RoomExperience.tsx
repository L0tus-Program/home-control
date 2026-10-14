import { useEffect, useMemo, useRef, useState } from 'react'
import { deviceKey } from '../../../../shared/devices'
import type { Command, Device } from '../../../../shared/types'
import { DeviceControlModal } from '../../components/DeviceControlModal'
import { RefreshIcon, SettingsIcon } from '../../components/Icons'
import { modeLabel } from '../../labels'
import { RoomScene } from './components/RoomScene'

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

export function RoomExperience({ devices, loading, pending, error, connected, onRefresh, onOpenSettings, onCommand }: Props): React.JSX.Element {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const roomName = 'Sala viva'
  const previousCount = useRef(devices.length)

  const devicesByKey = useMemo(() => new Map(devices.map((device) => [deviceKey(device), device])), [devices])
  const selectedDevice = selectedKey ? devicesByKey.get(selectedKey) : undefined
  const onlineCount = devices.filter((device) => device.driverId !== 'tuya' || device.state.online).length
  const onCount = devices.filter((device) => device.state.power).length
  const ambientTemp = devices.find((device) => device.kind === 'air-conditioner' && device.state.currentTemperature !== undefined)?.state.currentTemperature

  useEffect(() => {
    if (previousCount.current === 0 && devices.length > 0) setSelectedKey(deviceKey(devices[0]))
    previousCount.current = devices.length
  }, [devices])

  useEffect(() => {
    if (selectedKey && !devicesByKey.has(selectedKey)) setSelectedKey(null)
  }, [devicesByKey, selectedKey])

  return (
    <section className="rooms-page" aria-label="Cômodo 3D">
      <div className="rooms-hero">
        <div>
          <div className="content__integration">Cômodos 3D</div>
          <h1>{roomName}, em outra dimensão.</h1>
          <p>Explore sua casa em 3D. Clique em lâmpadas e ar-condicionado para controlar tudo em tempo real.</p>
        </div>
        <div className="rooms-hero__actions">
          <button type="button" className="btn btn--ghost" disabled={loading || !connected} onClick={onRefresh}>
            <RefreshIcon />{loading ? 'Atualizando…' : 'Atualizar casa'}
          </button>
          <button type="button" className="btn btn--primary" onClick={onOpenSettings}>
            <SettingsIcon size={15} />Preferências
          </button>
        </div>
      </div>

      {error && (
        <div className="alert room-alert" role="alert">
          <span>{error}</span>
        </div>
      )}

      <div className="room-layout room-layout--3d">
        <div className="room-stage-card room-stage-card--3d">
          <div className="room-stage-card__meta">
            <div>
              <span className="modal__kicker">
                <span>Casa conectada</span>
                <span>{connected ? `${onlineCount}/${devices.length || 0} disponíveis` : 'Integrações pendentes'}</span>
              </span>
              <h2>{roomName}</h2>
              <p>{devices.length ? `${devices.length} aparelhos · ${onCount} ligados` : 'Conecte LG e Tuya para povoar o cômodo.'}</p>
            </div>
            <div className="room-weather" aria-label="Temperatura ambiente">
              <strong>{ambientTemp !== undefined ? `${Math.round(ambientTemp)}°C` : '—'}</strong>
              <span>ambiente</span>
            </div>
          </div>

          <RoomScene devices={devices} selectedKey={selectedKey} onSelect={setSelectedKey} />
        </div>

        <aside className="room-panel" aria-label="Aparelhos do cômodo">
          <div className="room-panel__head">
            <div>
              <span className="content__integration">Dispositivos</span>
              <h3>Toque para controlar</h3>
            </div>
            <span>{devices.length}</span>
          </div>
          <div className="room-device-list">
            {devices.map((device) => {
              const key = deviceKey(device)
              return (
                <button key={key} type="button" className={selectedKey === key ? 'is-selected' : undefined} onClick={() => setSelectedKey(selectedKey === key ? null : key)}>
                  <span className={`device-dot device-dot--${device.kind}${device.state.power ? ' is-on' : ''}`} />
                  <span>
                    <strong>{device.name}</strong>
                    <small>{deviceStatus(device)}</small>
                  </span>
                </button>
              )
            })}
            {!devices.length && (
              <p className="room-panel__empty">Nenhum aparelho carregado para exibir neste cômodo.</p>
            )}
          </div>
        </aside>
      </div>

      {selectedDevice && (
        <DeviceControlModal
          device={selectedDevice}
          busy={pending.has(deviceKey(selectedDevice))}
          onClose={() => setSelectedKey(null)}
          onCommand={(command) => onCommand(selectedDevice, command)}
        />
      )}
    </section>
  )
}
