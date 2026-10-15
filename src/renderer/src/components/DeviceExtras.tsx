import type { Command, Device, OptionKey } from '../../../shared/types'
import { optionLabel } from '../labels'

interface Props {
  device: Device
  disabled: boolean
  onCommand: (command: Command) => void
}

/**
 * Ajustes alem dos controles principais, comuns ao card e ao modal. So aparece
 * o que o modelo declara: cada aparelho tem o seu conjunto.
 */
export function DeviceExtras({ device, disabled, onCommand }: Props): React.JSX.Element | null {
  const options = device.capabilities.flatMap((cap) => (cap.kind === 'option' ? [cap.key] : [])) as OptionKey[]
  if (options.length === 0) return null
  return (
    <div className="control">
      <div className="control__label">Ajustes</div>
      <div className="segmented">
        {options.map((key) => {
          const on = device.state.options?.[key] === true
          return (
            <button key={key} type="button" disabled={disabled} className={on ? 'is-active' : undefined}
              aria-pressed={on} onClick={() => onCommand({ type: 'option', key, value: !on })}>
              {optionLabel(key)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
