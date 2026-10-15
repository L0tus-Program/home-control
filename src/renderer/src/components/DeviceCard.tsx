import type { Capability, Command, Device } from '../../../shared/types'
import { fanLabel, modeLabel, moodFor } from '../labels'
import { PowerIcon } from './Icons'
import { DeviceExtras } from './DeviceExtras'
import { LightControls } from './LightControls'
import { TemperatureDial } from './TemperatureDial'

interface Props {
  device: Device
  busy: boolean
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

function Segmented({
  label,
  options,
  active,
  disabled,
  format,
  onPick
}: SegmentedProps): React.JSX.Element {
  return (
    <div className="control">
      <div className="control__label">{label}</div>
      <div className="segmented">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            className={option === active ? 'is-active' : undefined}
            aria-pressed={option === active}
            onClick={() => onPick(option)}
          >
            {format(option)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function DeviceCard({ device, busy, onCommand }: Props): React.JSX.Element {
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

  const className = [
    'card',
    state.power && 'card--on',
    busy && 'card--busy',
    mood === 'heat' && 'card--heat'
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={className}>
      <header className="card__head">
        <div>
          <div className="card__name">{device.name}</div>
          <div className="card__meta">
            {device.model ?? (device.driverId === 'tuya' ? 'Tuya' : 'LG')}
            {offline ? ' · Offline' : ''}
            {state.mode ? ` · ${modeLabel(state.mode)}` : ''}
          </div>
        </div>

        {controllable && (
          <button
            type="button"
            className={`power${state.power ? ' power--on' : ''}${
              mood === 'heat' ? ' power--heat' : ''
            }`}
            disabled={busy || offline}
            aria-label={state.power ? 'Desligar' : 'Ligar'}
            aria-pressed={state.power}
            onClick={() => onCommand({ type: 'power', value: !state.power })}
          >
            <PowerIcon />
          </button>
        )}
      </header>

      {!controllable && (
        <p className="card__meta" style={{ marginTop: 14 }}>
          Este aparelho aparece na sua conta, mas o Home Control ainda não tem controles para
          ele.
        </p>
      )}

      {temperature && (
        <TemperatureDial
          value={state.temperature ?? temperature.min}
          min={temperature.min}
          max={temperature.max}
          step={temperature.step}
          mood={mood}
          disabled={offline || !state.power || busy}
          currentTemperature={state.currentTemperature}
          onChange={(value) => onCommand({ type: 'temperature', value })}
        />
      )}

      {(brightness || hasColor || hasColorTemperature) && (
        <LightControls
          brightness={brightness}
          hasColor={hasColor}
          hasColorTemperature={hasColorTemperature}
          value={{ brightness: state.brightness, color: state.color, colorTemperature: state.colorTemperature, mode: state.mode }}
          disabled={offline || !state.power || busy}
          onCommand={onCommand}
        />
      )}

      {modes && (
        <Segmented
          label="Modo"
          options={modes.options}
          active={state.mode}
          disabled={offline || !state.power || busy}
          format={modeLabel}
          onPick={(value) => onCommand({ type: 'mode', value })}
        />
      )}

      {fans && (
        <Segmented
          label="Ventilacao"
          options={fans.options}
          active={state.fan}
          disabled={offline || !state.power || busy}
          format={fanLabel}
          onPick={(value) => onCommand({ type: 'fan', value })}
        />
      )}

      <DeviceExtras device={device} disabled={offline || !state.power || busy} onCommand={onCommand} />

      {(state.currentTemperature !== undefined || state.humidity !== undefined || state.airQuality) && (
        <div className="readings">
          {state.currentTemperature !== undefined && (
            <div>
              <div className="reading__label">Ambiente</div>
              <div className="reading__value">{Math.round(state.currentTemperature)}°C</div>
            </div>
          )}
          {state.humidity !== undefined && (
            <div>
              <div className="reading__label">Umidade</div>
              <div className="reading__value">{Math.round(state.humidity)}%</div>
            </div>
          )}
          {state.airQuality?.pm25 !== undefined && (
            <div>
              <div className="reading__label">PM2.5</div>
              <div className="reading__value">{Math.round(state.airQuality.pm25)}</div>
            </div>
          )}
        </div>
      )}
    </article>
  )
}
