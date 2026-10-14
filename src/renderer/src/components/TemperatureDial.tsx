import { useCallback, useId, useRef, useState } from 'react'

const SIZE = 232
const RADIUS = 94
const STROKE = 13
const CENTER = SIZE / 2

/** Arco de 270 graus com a abertura embaixo. */
const START = 135
const SWEEP = 270

const GRADIENTS = {
  cool: ['#44e0ff', '#6f7bff'],
  heat: ['#ffb03a', '#ff5f6d'],
  neutral: ['#7c8699', '#4a5465']
} as const

export type Mood = keyof typeof GRADIENTS

interface Props {
  value: number
  min: number
  max: number
  step: number
  mood: Mood
  disabled?: boolean
  currentTemperature?: number
  onChange: (value: number) => void
}

function polar(angleDeg: number, radius = RADIUS): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) }
}

function arcPath(from: number, to: number): string {
  const a = polar(from)
  const b = polar(to)
  return `M ${a.x} ${a.y} A ${RADIUS} ${RADIUS} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x} ${b.y}`
}

export function TemperatureDial({
  value,
  min,
  max,
  step,
  mood,
  disabled = false,
  currentTemperature,
  onChange
}: Props): React.JSX.Element {
  const gradientId = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  // Enquanto arrasta, o mostrador segue o dedo; o comando so sai ao soltar.
  const [draft, setDraft] = useState<number | null>(null)

  const shown = draft ?? value
  const span = Math.max(max - min, 1)
  const ratio = Math.min(Math.max((shown - min) / span, 0), 1)
  const knob = polar(START + ratio * SWEEP)
  const [from, to] = GRADIENTS[mood]

  const valueAt = useCallback(
    (clientX: number, clientY: number): number => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return shown

      const dx = clientX - (rect.left + rect.width / 2)
      const dy = clientY - (rect.top + rect.height / 2)
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI
      let rel = (angle - START + 360) % 360

      // Dentro da abertura de baixo: prende na ponta mais proxima.
      if (rel > SWEEP) rel = rel - SWEEP > (360 - SWEEP) / 2 ? 0 : SWEEP

      const raw = min + (rel / SWEEP) * span
      return Math.min(Math.max(min + Math.round((raw - min) / step) * step, min), max)
    },
    [max, min, shown, span, step]
  )

  const handleDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (disabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraft(valueAt(event.clientX, event.clientY))
  }

  const handleMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (disabled || draft === null) return
    setDraft(valueAt(event.clientX, event.clientY))
  }

  const handleUp = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (draft === null) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const next = draft
    setDraft(null)
    if (next !== value) onChange(next)
  }

  const handleKey = (event: React.KeyboardEvent<SVGSVGElement>): void => {
    if (disabled) return
    const delta = { ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step }[
      event.key
    ]
    if (delta === undefined) return
    event.preventDefault()
    const next = Math.min(Math.max(value + delta, min), max)
    if (next !== value) onChange(next)
  }

  return (
    <div
      className={`dial${draft !== null ? ' dial--dragging' : ''}${disabled ? ' dial--off' : ''}`}
      style={{ width: SIZE, height: SIZE }}
    >
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Temperatura desejada"
        aria-valuenow={shown}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={`${shown} graus`}
        aria-disabled={disabled}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onKeyDown={handleKey}
        style={{ cursor: disabled ? 'default' : 'pointer' }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>

        <path
          className="dial__track"
          d={arcPath(START, START + SWEEP)}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />

        <path
          className="dial__progress"
          d={arcPath(START, START + SWEEP)}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={STROKE}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - ratio}
          opacity={disabled ? 0.35 : 1}
        />

        {!disabled && (
          <circle
            className="dial__knob"
            cx={knob.x}
            cy={knob.y}
            r={draft !== null ? 11 : 9}
            fill="#fff"
            stroke={to}
            strokeWidth={3}
          />
        )}
      </svg>

      <div className="dial__readout">
        <div className="dial__value">
          {Math.round(shown)}
          <sup>°</sup>
        </div>
        <div className={`dial__caption${disabled ? ' dial__caption--off' : ''}`}>
          {disabled
            ? 'desligado'
            : currentTemperature !== undefined
              ? `ambiente ${Math.round(currentTemperature)}°`
              : 'alvo'}
        </div>
      </div>
    </div>
  )
}
