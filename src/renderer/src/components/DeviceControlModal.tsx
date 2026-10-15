import { useEffect } from 'react'
import type { Capability, Command, Device } from '../../../shared/types'
import { fanLabel, modeLabel, moodFor } from '../labels'
import { PowerIcon } from './Icons'
import { DeviceExtras } from './DeviceExtras'
import { LightControls } from './LightControls'
import { TemperatureDial } from './TemperatureDial'

interface Props {
  device: Device
  busy: boolean
  onClose: () => void
  onCommand: (command: Command) => void
}

function capability<K extends Capability['kind']>(
  device: Device,
  kind: K
): Extract<Capability, { kind: K }> | undefined {
  return device.capabilities.find((item) => item.kind === kind) as
    | Extract<Capability, { kind: K }>
    | undefined
}

interface SegmentedProps {
  label: string
  options: string[]
  active: string | undefined
  disabled: boolean
  format: (value: string) => string
  onPick: (value: string) => void
}

function Segmented({ label, options, active, disabled, format, onPick }: SegmentedProps): React.JSX.Element {
  return (
    <div className="control">
      <div className="control__label">{label}</div>
      <div className="segmented">
        {options.map((option) => (
          <button key={option} type="button" disabled={disabled} className={option === active ? 'is-active' : undefined}
            aria-pressed={option === active} onClick={() => onPick(option)}>
            {format(option)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** O que resta do filtro, quando da para saber; senao, as horas de uso. */
export function filterReading(filter: Device['state']['filter']): string | undefined {
  if (!filter) return undefined
  if (filter.remainingPercent !== undefined) return `${Math.round(filter.remainingPercent)}%`
  if (filter.lifetimeHours !== undefined && filter.usedHours !== undefined) {
    return `${Math.max(0, Math.round(100 - (filter.usedHours / filter.lifetimeHours) * 100))}%`
  }
  return filter.usedHours !== undefined ? `${Math.round(filter.usedHours)} h de uso` : undefined
}

export function DeviceControlModal({ device, busy, onClose, onCommand }: Props): React.JSX.Element {
  const { state } = device
  const offline = device.driverId === 'tuya' && !state.online
  const mood = moodFor(state.mode, state.power)
  const temperature = capability(device, 'temperature')
  const modes = capability(device, 'mode')
  const fans = capability(device, 'fan')
  const brightness = capability(device, 'brightness')
  const hasColor = capability(device, 'color') !== undefined
  const hasColorTemperature = capability(device, 'colorTemperature') !== undefined
  const controllable = device.capabilities.length > 0
  const disabled = offline || busy

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay room-modal-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className={`modal room-device-modal${mood === 'heat' ? ' room-device-modal--heat' : ''}`} role="dialog" aria-modal="true" aria-labelledby="room-device-title">
        <div className="modal__kicker">
          <span>{device.driverId === 'tuya' ? 'Tuya' : 'LG ThinQ'}</span>
          <span>{offline ? 'Offline' : busy ? 'Enviando comando…' : 'Conectado'}</span>
        </div>
        <div className="room-device-modal__head">
          <div>
            <h2 id="room-device-title">{device.name}</h2>
            <p>{device.model ?? (device.kind === 'light' ? 'Luz inteligente' : device.kind === 'air-conditioner' ? 'Climatização' : 'Aparelho conectado')}</p>
          </div>
          <button type="button" className="room-device-modal__close" aria-label="Fechar controles" onClick={onClose}>×</button>
        </div>

        {controllable && (
          <div className="room-power-row">
            <div>
              <strong>{state.power ? 'Ligado' : 'Desligado'}</strong>
              <small>{busy ? 'Aguardando confirmação da integração' : 'Controle real do aparelho'}</small>
            </div>
            <button type="button" className={`power${state.power ? ' power--on' : ''}${mood === 'heat' ? ' power--heat' : ''}`}
              disabled={disabled} aria-label={state.power ? 'Desligar' : 'Ligar'} aria-pressed={state.power}
              onClick={() => onCommand({ type: 'power', value: !state.power })}>
              <PowerIcon />
            </button>
          </div>
        )}

        {!controllable && (
          <p className="room-device-modal__empty">Este aparelho aparece na sua conta, mas ainda não tem controles disponíveis no Home Control.</p>
        )}

        {temperature && (
          <TemperatureDial value={state.temperature ?? temperature.min} min={temperature.min} max={temperature.max}
            step={temperature.step} mood={mood} disabled={disabled || !state.power}
            currentTemperature={state.currentTemperature} onChange={(value) => onCommand({ type: 'temperature', value })} />
        )}

        {(brightness || hasColor || hasColorTemperature) && (
          <LightControls brightness={brightness} hasColor={hasColor}
          hasColorTemperature={hasColorTemperature}
            value={{ brightness: state.brightness, color: state.color, colorTemperature: state.colorTemperature, mode: state.mode }} disabled={disabled || !state.power}
            onCommand={onCommand} />
        )}

        {modes && (
          <Segmented label="Modo" options={modes.options} active={state.mode} disabled={disabled || !state.power}
            format={modeLabel} onPick={(value) => onCommand({ type: 'mode', value })} />
        )}

        {fans && (
          <Segmented label="Ventilação" options={fans.options} active={state.fan} disabled={disabled || !state.power}
            format={fanLabel} onPick={(value) => onCommand({ type: 'fan', value })} />
        )}

        <DeviceExtras device={device} disabled={disabled} onCommand={onCommand} />

        {(state.currentTemperature !== undefined || state.humidity !== undefined || state.airQuality || state.filter) && (
          <div className="readings">
            {state.currentTemperature !== undefined && <div><div className="reading__label">Ambiente</div><div className="reading__value">{Math.round(state.currentTemperature)}°C</div></div>}
            {state.humidity !== undefined && <div><div className="reading__label">Umidade</div><div className="reading__value">{Math.round(state.humidity)}%</div></div>}
            {state.airQuality?.pm1 !== undefined && <div><div className="reading__label">PM1</div><div className="reading__value">{Math.round(state.airQuality.pm1)}</div></div>}
            {state.airQuality?.pm25 !== undefined && <div><div className="reading__label">PM2.5</div><div className="reading__value">{Math.round(state.airQuality.pm25)}</div></div>}
            {state.airQuality?.pm10 !== undefined && <div><div className="reading__label">PM10</div><div className="reading__value">{Math.round(state.airQuality.pm10)}</div></div>}
            {filterReading(state.filter) && <div><div className="reading__label">Filtro</div><div className="reading__value">{filterReading(state.filter)}</div></div>}
          </div>
        )}
      </section>
    </div>
  )
}
