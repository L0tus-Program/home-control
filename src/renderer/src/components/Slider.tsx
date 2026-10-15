import { useCallback, useRef, useState } from 'react'

interface Props {
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  label: string
  /** CSS de fundo da trilha; e por aqui que entra o arco-iris do matiz. */
  trackBackground: string
  /** Cor do punho, para ele combinar com o ponto escolhido. */
  knobColor?: string
  format?: (value: number) => string
  /** Dispara mesmo soltando no valor atual (reaplicar, como voltar ao branco). */
  commitUnchanged?: boolean
  onChange: (value: number) => void
}

/**
 * Trilha horizontal arrastavel. Mesmo contrato do mostrador do ar: segue o
 * dedo em estado local e so dispara o comando quando solta.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  disabled = false,
  label,
  trackBackground,
  knobColor = '#fff',
  format,
  commitUnchanged = false,
  onChange
}: Props): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<number | null>(null)

  const shown = draft ?? value
  const span = Math.max(max - min, 1)
  const ratio = Math.min(Math.max((shown - min) / span, 0), 1)

  const valueAt = useCallback(
    (clientX: number): number => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return shown
      const position = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
      const raw = min + position * span
      return Math.min(Math.max(min + Math.round((raw - min) / step) * step, min), max)
    },
    [max, min, shown, span, step]
  )

  const handleDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (disabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDraft(valueAt(event.clientX))
  }

  const handleMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (disabled || draft === null) return
    setDraft(valueAt(event.clientX))
  }

  const handleUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (draft === null) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const next = draft
    setDraft(null)
    if (next !== value || commitUnchanged) onChange(next)
  }

  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return
    const delta = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step }[
      event.key
    ]
    if (delta === undefined) return
    event.preventDefault()
    const next = Math.min(Math.max(value + delta, min), max)
    if (next !== value) onChange(next)
  }

  return (
    <div className="control">
      <div className="control__label">
        {label}
        {format && <span className="control__value">{format(shown)}</span>}
      </div>
      <div
        ref={trackRef}
        className={`slider${disabled ? ' slider--off' : ''}${
          draft !== null ? ' slider--dragging' : ''
        }`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={shown}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-disabled={disabled}
        style={{ background: trackBackground }}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onKeyDown={handleKey}
      >
        <div
          className="slider__knob"
          style={{ left: `${ratio * 100}%`, background: knobColor }}
        />
      </div>
    </div>
  )
}
