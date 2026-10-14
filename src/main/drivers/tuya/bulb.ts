import type { ColorState, DeviceState } from '../../../shared/types'

/**
 * Tradução entre os "data points" (DP) de uma lâmpada Tuya e o nosso
 * DeviceState. A Tuya tem dois esquemas de numeração; detectamos qual o
 * aparelho usa pela presença do DP de ligar.
 *
 * Esquema A (antigo):  1=power 2=modo 3=brilho(25-255)  5=cor
 * Esquema B (novo):   20=power 21=modo 22=brilho(10-1000) 24=cor
 *
 * ATENÇÃO: o mapeamento exato de DP varia por modelo. Isto cobre as duas
 * famílias padrão de lâmpada RGB; os números e faixas devem ser conferidos
 * contra o primeiro `query` real de cada lâmpada e ajustados se necessário.
 */

interface Schema {
  power: string
  mode: string
  brightness: string
  color: string
  brightnessMin: number
  brightnessMax: number
}

const SCHEMA_A: Schema = {
  power: '1',
  mode: '2',
  brightness: '3',
  color: '5',
  brightnessMin: 25,
  brightnessMax: 255
}

const SCHEMA_B: Schema = {
  power: '20',
  mode: '21',
  brightness: '22',
  color: '24',
  brightnessMin: 10,
  brightnessMax: 1000
}

export function detectSchema(dps: Record<string, unknown>): Schema {
  return '20' in dps ? SCHEMA_B : SCHEMA_A
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Cor Tuya: hex de hue(0-360) + sat(0-1000) + val(0-1000), 4 dígitos cada. */
function parseColor(hex: unknown): ColorState | undefined {
  if (typeof hex !== 'string' || hex.length < 12) return undefined
  const hue = parseInt(hex.slice(0, 4), 16)
  const sat = parseInt(hex.slice(4, 8), 16)
  if (Number.isNaN(hue) || Number.isNaN(sat)) return undefined
  return { hue: clamp(hue, 0, 359), saturation: clamp(Math.round(sat / 10), 0, 100) }
}

function buildColor(color: ColorState): string {
  const hue = clamp(Math.round(color.hue), 0, 360)
  const sat = clamp(Math.round(color.saturation * 10), 0, 1000)
  const val = 1000 // intensidade da cor no máximo; o brilho mora no DP próprio
  const h = hue.toString(16).padStart(4, '0')
  const s = sat.toString(16).padStart(4, '0')
  const v = val.toString(16).padStart(4, '0')
  return `${h}${s}${v}`
}

export function readState(dps: Record<string, unknown>): DeviceState {
  const schema = detectSchema(dps)
  const rawBrightness = dps[schema.brightness]
  const span = schema.brightnessMax - schema.brightnessMin

  let brightness: number | undefined
  if (typeof rawBrightness === 'number') {
    brightness = clamp(Math.round(((rawBrightness - schema.brightnessMin) / span) * 100), 1, 100)
  }

  return {
    online: true,
    power: dps[schema.power] === true,
    brightness,
    color: parseColor(dps[schema.color])
  }
}

export function powerDps(dps: Record<string, unknown>, on: boolean): Record<string, unknown> {
  return { [detectSchema(dps).power]: on }
}

export function brightnessDps(
  dps: Record<string, unknown>,
  percent: number
): Record<string, unknown> {
  const schema = detectSchema(dps)
  const span = schema.brightnessMax - schema.brightnessMin
  const value = Math.round(schema.brightnessMin + (clamp(percent, 1, 100) / 100) * span)
  return { [schema.brightness]: value }
}

export function colorDps(
  dps: Record<string, unknown>,
  color: ColorState
): Record<string, unknown> {
  const schema = detectSchema(dps)
  // Trocar a cor sem pôr a lâmpada em modo "colour" não tem efeito visível.
  return { [schema.mode]: 'colour', [schema.color]: buildColor(color) }
}
