import type { Capability, Command, Device, OptionKey, TimerAction } from '../../../shared/types'
import { optionLabel } from '../labels'

interface Props {
  device: Device
  /** Offline ou com comando em voo. */
  disabled: boolean
  onCommand: (command: Command) => void
}

const PRESETS = [15, 30, 60, 120, 240]

export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

function TimerControl({ device, timer, disabled, onCommand }: Props & { timer: Extract<Capability, { kind: 'timer' }> }): React.JSX.Element | null {
  // Ligado, o timer util e o de desligar; desligado, o de ligar.
  const action: TimerAction = device.state.power ? 'off' : 'on'
  if (!timer.actions.includes(action)) return null
  const left = device.state.timer?.[action]
  const verb = action === 'off' ? 'Desligar' : 'Ligar'
  const status = left === undefined ? undefined : left === 0 ? 'programado' : `em ${durationLabel(left)}`
  return (
    <div className="control">
      <div className="control__label">{verb} em{status ? ` · ${verb.toLowerCase()} ${status}` : ''}</div>
      <div className="segmented">
        {PRESETS.filter((minutes) => minutes <= timer.maxMinutes).map((minutes) => (
          <button key={minutes} type="button" disabled={disabled} className={left === minutes ? 'is-active' : undefined}
            onClick={() => onCommand({ type: 'timer', action, minutes })}>
            {durationLabel(minutes)}
          </button>
        ))}
        {left !== undefined && (
          <button type="button" disabled={disabled} onClick={() => onCommand({ type: 'timer', action, minutes: null })}>
            Cancelar
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Ajustes alem dos controles principais, comuns ao card e ao modal. So aparece
 * o que o modelo declara: cada aparelho tem o seu conjunto.
 */
export function DeviceExtras({ device, disabled, onCommand }: Props): React.JSX.Element | null {
  const options = device.capabilities.flatMap((cap) => (cap.kind === 'option' ? [cap.key] : [])) as OptionKey[]
  const timer = device.capabilities.find((cap): cap is Extract<Capability, { kind: 'timer' }> => cap.kind === 'timer')
  if (options.length === 0 && !timer) return null
  return (
    <>
      {options.length > 0 && (
        <div className="control">
          <div className="control__label">Ajustes</div>
          <div className="segmented">
            {options.map((key) => {
              const on = device.state.options?.[key] === true
              return (
                // Ajustes valem com o aparelho ligado, como modo e ventilacao.
                <button key={key} type="button" disabled={disabled || !device.state.power} className={on ? 'is-active' : undefined}
                  aria-pressed={on} onClick={() => onCommand({ type: 'option', key, value: !on })}>
                  {optionLabel(key)}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {timer && <TimerControl device={device} timer={timer} disabled={disabled} onCommand={onCommand} />}
    </>
  )
}
