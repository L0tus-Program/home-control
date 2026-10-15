import type { Capability, ColorState, Command } from '../../../shared/types'
import { WHITE_TONE_TRACK, whiteTone, whiteToneLabel } from '../lightTone'
import { Slider } from './Slider'

interface Props {
  brightness?: Extract<Capability, { kind: 'brightness' }>
  hasColor: boolean
  hasColorTemperature?: boolean
  value: { brightness?: number; color?: ColorState; colorTemperature?: number }
  disabled: boolean
  onCommand: (command: Command) => void
}

const HUE_RAINBOW =
  'linear-gradient(90deg, #ff4d4d, #ffd93d, #6bff6b, #4de0ff, #4d6bff, #d44dff, #ff4d4d)'

/** A cor escolhida; no modo branco, o tom do branco (ou branco neutro sem tom). */
function cssColor(color: ColorState | undefined, lightness = 55, colorTemperature?: number): string {
  if (!color) return colorTemperature === undefined ? `hsl(0, 0%, ${lightness + 25}%)` : whiteTone(colorTemperature)
  return `hsl(${color.hue}, ${color.saturation}%, ${lightness}%)`
}

export function LightControls({
  brightness,
  hasColor,
  hasColorTemperature = false,
  value,
  disabled,
  onCommand
}: Props): React.JSX.Element {
  const color = value.color
  const level = value.brightness ?? brightness?.max ?? 100
  const range = { min: brightness?.min ?? 1, max: brightness?.max ?? 100 }
  const percent = Math.round(level)

  const tone = value.colorTemperature
  const glow = cssColor(color, 55, tone)

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

      {hasColorTemperature && (
        <Slider
          label="Tom do branco"
          value={tone ?? 50}
          min={0}
          max={100}
          disabled={disabled}
          trackBackground={WHITE_TONE_TRACK}
          knobColor={whiteTone(tone ?? 50)}
          format={(next) => whiteToneLabel(next)}
          onChange={(next) => onCommand({ type: 'colorTemperature', value: next })}
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
