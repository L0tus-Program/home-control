/** Extremos do branco das lampadas: ~2700 K (quente) e ~6500 K (frio). */
const WARM = [255, 178, 102] as const
const COLD = [212, 231, 255] as const

/** Cor aproximada do branco para a UI e a maquete: 0 (quente) a 100 (frio). */
export function whiteTone(percent: number): string {
  const t = Math.min(Math.max(percent, 0), 100) / 100
  const channel = (i: 0 | 1 | 2): string => Math.round(WARM[i] + (COLD[i] - WARM[i]) * t).toString(16).padStart(2, '0')
  return `#${channel(0)}${channel(1)}${channel(2)}`
}

export const WHITE_TONE_TRACK = `linear-gradient(90deg, ${whiteTone(0)}, ${whiteTone(50)}, ${whiteTone(100)})`

export function whiteToneLabel(percent: number): string {
  if (percent < 34) return 'Quente'
  if (percent < 67) return 'Neutro'
  return 'Frio'
}
