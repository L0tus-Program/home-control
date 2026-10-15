import { useEffect, useState } from 'react'
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

/** Prazo livre, em minutos, alem dos atalhos. */
function CustomTimer({ max, disabled, action, onSet }: { max: number; disabled: boolean; action: TimerAction; onSet: (minutes: number) => void }): React.JSX.Element {
  const [value, setValue] = useState('')
  // Prazo digitado para desligar nao vira, sem querer, prazo para ligar.
  useEffect(() => setValue(''), [action])
  const minutes = Number(value)
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= max
  return (
    <form className="timer__custom" onSubmit={(event) => { event.preventDefault(); if (valid) { onSet(minutes); setValue('') } }}>
      <input type="number" inputMode="numeric" min={1} max={max} step={1} placeholder="Outro prazo" aria-label="Prazo em minutos"
        value={value} disabled={disabled} onChange={(event) => setValue(event.target.value)} />
      <span>min</span>
      <button type="submit" disabled={disabled || !valid}>Programar</button>
    </form>
  )
}

function TimerControl({ device, timer, disabled, onCommand }: Props & { timer: Extract<Capability, { kind: 'timer' }> }): React.JSX.Element | null {
  // Os atalhos so para a acao coerente: ligado, desligar; desligado, ligar.
  const action: TimerAction = device.state.power ? 'off' : 'on'
  const offer = timer.actions.includes(action)
  // Timers ja programados aparecem todos, cada um com o seu Cancelar (no ar os dois podem coexistir).
  const active = (['off', 'on'] as TimerAction[]).flatMap((key) => {
    const left = device.state.timer?.[key]
    return left === undefined ? [] : [{ key, left }]
  })
  if (!offer && active.length === 0) return null
  const verb = (key: TimerAction): string => (key === 'off' ? 'Desliga' : 'Liga')
  return (
    <div className="control">
      <div className="control__label">{offer ? `${action === 'off' ? 'Desligar' : 'Ligar'} em` : 'Timer'}</div>
      {active.map(({ key, left }) => (
        <div key={key} className="timer__active">
          <span>{verb(key)} {left === 0 ? 'no horário programado' : `em ${durationLabel(left)}`}</span>
          <button type="button" disabled={disabled} onClick={() => onCommand({ type: 'timer', action: key, minutes: null })}>
            Cancelar
          </button>
        </div>
      ))}
      {offer && (
        <div className="segmented">
          {PRESETS.filter((minutes) => minutes <= timer.maxMinutes).map((minutes) => (
            <button key={minutes} type="button" disabled={disabled} onClick={() => onCommand({ type: 'timer', action, minutes })}>
              {durationLabel(minutes)}
            </button>
          ))}
        </div>
      )}
      {offer && <CustomTimer max={timer.maxMinutes} disabled={disabled} action={action} onSet={(minutes) => onCommand({ type: 'timer', action, minutes })} />}
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
