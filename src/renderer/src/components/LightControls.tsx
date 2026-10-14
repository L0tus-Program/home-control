import type { Capability, ColorState, Command } from '../../../shared/types'
import { Slider } from './Slider'

interface Props {
  brightness?: Extract<Capability, { kind: 'brightness' }>
  hasColor: boolean
  value: { brightness?: number; color?: ColorState }
  disabled: boolean
  onCommand: (command: Command) => void
}

const HUE_RAINBOW =
  'linear-gradient(90deg, #ff4d4d, #ffd93d, #6bff6b, #4de0ff, #4d6bff, #d44dff, #ff4d4d)'

/** Lampada branca quando nao ha cor; senao, a cor escolhida. */
function cssColor(color: ColorState | undefined, lightness = 55): string {
  if (!color) return `hsl(0, 0%, ${lightness + 25}%)`
  return `hsl(${color.hue}, ${color.saturation}%, ${lightness}%)`
}

export function LightControls({
  brightness,
  hasColor,
  value,
  disabled,
  onCommand
}: Props): React.JSX.Element {
  const color = value.color
  const level = value.brightness ?? brightness?.max ?? 100
  const range = { min: brightness?.min ?? 1, max: brightness?.max ?? 100 }
  const percent = Math.round(((level - range.min) / Math.max(range.max - range.min, 1)) * 100)

  const glow = cssColor(color)

  return (
    <>
      <div className="orb" aria-hidden="true">
        <div
          className="orb__core"
          style={{
            background: `radial-gradient(circle at 50% 42%, ${glow}, transparent 68%)`,
            // Apagada fica so o contorno; acesa o brilho acompanha a intensidade.
            opacity: disabled ? 0.12 : 0.35 + (percent / 100) * 0.65
          }}
        />
        <div className="orb__ring" style={{ borderColor: disabled ? undefined : glow }} />
        <div className="orb__readout">{disabled ? '—' : `${percent}%`}</div>
      </div>

      {brightness && (
        <Slider
          label="Intensidade"
          value={level}
          min={range.min}
          max={range.max}
          disabled={disabled}
          trackBackground={`linear-gradient(90deg, #11131a, ${glow})`}
          knobColor={glow}
          format={() => `${percent}%`}
          onChange={(next) => onCommand({ type: 'brightness', value: next })}
        />
      )}

      {hasColor && (
        <Slider
          label="Cor"
          value={color?.hue ?? 0}
          min={0}
          max={359}
          disabled={disabled}
          trackBackground={HUE_RAINBOW}
          knobColor={cssColor({ hue: color?.hue ?? 0, saturation: 100 })}
          onChange={(hue) =>
            onCommand({ type: 'color', value: { hue, saturation: color?.saturation ?? 100 } })
          }
        />
      )}
    </>
  )
}
