import type { ColorState, DeviceState } from '../../../shared/types'
import type { TuyaCommand, TuyaFunction, TuyaStatusItem } from './cloud'
import { DriverError } from '../types'

interface ColorHsv { h: number; s: number; v: number }
interface Range { min: number; max: number; step: number }

function statusMap(status: TuyaStatusItem[]): Map<string, unknown> {
  return new Map(status.map((item) => [item.code, item.value]))
}

function pick(status: TuyaStatusItem[], functions: TuyaFunction[], ...codes: string[]): string | undefined {
  const available = new Set((functions.length ? functions : status).map((item) => item.code))
  return codes.find((code) => available.has(code))
}

function safeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return null }
}

function parseHsv(value: unknown): ColorHsv | null {
  const raw = safeJson(value) as Partial<ColorHsv> | null
  if (!raw || typeof raw !== 'object') return null
  const { h, s, v } = raw
  return typeof h === 'number' && Number.isFinite(h) && typeof s === 'number' && Number.isFinite(s) && typeof v === 'number' && Number.isFinite(v)
    ? { h, s, v } : null
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) throw new DriverError('O valor do comando precisa ser um número válido.')
  return Math.min(Math.max(value, min), max)
}

function brightnessRange(code: string, functions: TuyaFunction[]): Range {
  const fallback = code.endsWith('_v2') ? { min: 10, max: 1000, step: 1 } : { min: 25, max: 255, step: 1 }
  const spec = safeJson(functions.find((item) => item.code === code)?.values) as Partial<Range> | null
  if (!spec || typeof spec.min !== 'number' || typeof spec.max !== 'number' || !Number.isFinite(spec.min) || !Number.isFinite(spec.max) || spec.max <= spec.min) return fallback
  return { min: spec.min, max: spec.max, step: typeof spec.step === 'number' && spec.step > 0 && Number.isFinite(spec.step) ? spec.step : 1 }
}

function colorMax(code: string): number { return code.endsWith('_v2') ? 1000 : 255 }
function percentToRaw(percent: number, range: Range): number {
  const raw = range.min + ((clamp(percent, 1, 100) - 1) / 99) * (range.max - range.min)
  return Math.min(range.max, range.min + Math.round((raw - range.min) / range.step) * range.step)
}
function rawToPercent(raw: number, range: Range): number {
  return clamp(Math.round(1 + ((raw - range.min) / (range.max - range.min)) * 99), 1, 100)
}

/** Faixa de `temp_value(_v2)`: a declarada nas funções, ou a padrão de cada versão. */
function tempRange(code: string, functions: TuyaFunction[]): Range {
  const fallback = code.endsWith('_v2') ? { min: 0, max: 1000, step: 1 } : { min: 0, max: 255, step: 1 }
  const spec = safeJson(functions.find((item) => item.code === code)?.values) as Partial<Range> | null
  if (!spec || typeof spec.min !== 'number' || typeof spec.max !== 'number' || !Number.isFinite(spec.min) || !Number.isFinite(spec.max) || spec.max <= spec.min) return fallback
  return { min: spec.min, max: spec.max, step: typeof spec.step === 'number' && spec.step > 0 && Number.isFinite(spec.step) ? spec.step : 1 }
}

/** Tuya: 0 e o branco mais quente e o maximo, o mais frio. */
function tempToPercent(raw: number, range: Range): number {
  return clamp(Math.round(((raw - range.min) / (range.max - range.min)) * 100), 0, 100)
}

function percentToTemp(percent: number, range: Range): number {
  const raw = range.min + (clamp(percent, 0, 100) / 100) * (range.max - range.min)
  return Math.min(range.max, range.min + Math.round((raw - range.min) / range.step) * range.step)
}

export function readState(status: TuyaStatusItem[], online: boolean, functions: TuyaFunction[] = []): DeviceState {
  const map = statusMap(status)
  const brightCode = pick(status, functions, 'bright_value_v2', 'bright_value')
  const colourCode = pick(status, functions, 'colour_data_v2', 'colour_data')
  const hsv = colourCode ? parseHsv(map.get(colourCode)) : null
  const mode = typeof map.get('work_mode') === 'string' ? map.get('work_mode') as string : undefined
  const rawBright = brightCode ? map.get(brightCode) : undefined
  const brightness = mode === 'colour' && hsv && colourCode
    ? clamp(Math.round(hsv.v / colorMax(colourCode) * 100), 1, 100)
    : typeof rawBright === 'number' && Number.isFinite(rawBright) && brightCode
      ? rawToPercent(rawBright, brightnessRange(brightCode, functions)) : undefined
  const color = hsv && colourCode && mode !== 'white'
    ? { hue: clamp(hsv.h, 0, 359), saturation: clamp(Math.round(hsv.s / colorMax(colourCode) * 100), 0, 100) } : undefined
  const tempCode = pick(status, functions, 'temp_value_v2', 'temp_value')
  const rawTemp = tempCode ? map.get(tempCode) : undefined
  const colorTemperature = typeof rawTemp === 'number' && Number.isFinite(rawTemp) && tempCode
    ? tempToPercent(rawTemp, tempRange(tempCode, functions)) : undefined
  const power = map.get('switch_led') === true
  return { online, power, brightness, color, mode, ...(colorTemperature === undefined ? {} : { colorTemperature }), ...readCountdown(status, power) }
}

const COUNTDOWN = 'countdown_1'
/** Padrao Tuya para `countdown_1`: segundos, ate 24 h. */
const COUNTDOWN_FALLBACK_MAX = 86_400

function countdownMax(functions: TuyaFunction[]): number {
  const spec = safeJson(functions.find((item) => item.code === COUNTDOWN)?.values) as { max?: unknown } | null
  return typeof spec?.max === 'number' && Number.isFinite(spec.max) && spec.max > 0 ? spec.max : COUNTDOWN_FALLBACK_MAX
}

export function hasCountdown(status: TuyaStatusItem[], functions: TuyaFunction[] = []): boolean {
  return Boolean(pick(status, functions, COUNTDOWN))
}

export function countdownMaxMinutes(functions: TuyaFunction[]): number {
  return Math.floor(countdownMax(functions) / 60)
}

/**
 * O contador inverte a energia quando zera: acesa, apaga; apagada, acende.
 * Por isso o timer em andamento e de "desligar" ou de "ligar" conforme o estado.
 */
export function readCountdown(status: TuyaStatusItem[], power: boolean): Pick<DeviceState, 'timer'> {
  const seconds = statusMap(status).get(COUNTDOWN)
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return {}
  return { timer: { [power ? 'off' : 'on']: Math.ceil(seconds / 60) } }
}

export function countdownCommand(minutes: number | null, functions: TuyaFunction[] = []): TuyaCommand {
  if (minutes === null) return { code: COUNTDOWN, value: 0 }
  const seconds = Math.round(minutes) * 60
  if (!Number.isFinite(seconds) || seconds < 60 || seconds > countdownMax(functions)) throw new DriverError('Prazo de timer inválido.')
  return { code: COUNTDOWN, value: seconds }
}

/** O tom so vale no modo branco: muda para ele se a lampada estiver em cor. */
export function colorTemperatureCommands(status: TuyaStatusItem[], percent: number, functions: TuyaFunction[] = []): TuyaCommand[] {
  const code = pick(status, functions, 'temp_value_v2', 'temp_value')
  if (!code) throw new DriverError('Esta lâmpada não permite ajustar o tom do branco.')
  const commands: TuyaCommand[] = []
  if (pick(status, functions, 'work_mode') && statusMap(status).get('work_mode') !== 'white') {
    commands.push({ code: 'work_mode', value: 'white' })
    // Em cor o brilho e o V da cor; no branco e o bright_value. Leva o atual junto para nao pular.
    const brightCode = pick(status, functions, 'bright_value_v2', 'bright_value')
    const brightness = readState(status, true, functions).brightness
    if (brightCode && brightness !== undefined) commands.push({ code: brightCode, value: percentToRaw(brightness, brightnessRange(brightCode, functions)) })
  }
  commands.push({ code, value: percentToTemp(percent, tempRange(code, functions)) })
  return commands
}

export function powerCommand(on: boolean): TuyaCommand {
  if (typeof on !== 'boolean') throw new DriverError('O comando de energia precisa ser verdadeiro ou falso.')
  return { code: 'switch_led', value: on }
}

export function brightnessCommand(status: TuyaStatusItem[], percent: number, functions: TuyaFunction[] = []): TuyaCommand {
  const map = statusMap(status)
  const colourCode = pick(status, functions, 'colour_data_v2', 'colour_data')
  if (map.get('work_mode') === 'colour' && colourCode) {
    const hsv = parseHsv(map.get(colourCode))
    if (!hsv) throw new DriverError('Atualize a lâmpada antes de ajustar a intensidade da cor.')
    return { code: colourCode, value: { ...hsv, v: Math.round(clamp(percent, 1, 100) / 100 * colorMax(colourCode)) } }
  }
  const code = pick(status, functions, 'bright_value_v2', 'bright_value')
  if (!code) throw new DriverError('Esta lâmpada não permite ajustar a intensidade neste modo.')
  return { code, value: percentToRaw(percent, brightnessRange(code, functions)) }
}

export function colorCommands(status: TuyaStatusItem[], color: ColorState, functions: TuyaFunction[] = []): TuyaCommand[] {
  const code = pick(status, functions, 'colour_data_v2', 'colour_data')
  if (!code) throw new DriverError('Esta lâmpada não permite ajustar a cor.')
  const brightness = readState(status, true, functions).brightness ?? 100
  const commands: TuyaCommand[] = []
  if (pick(status, functions, 'work_mode')) commands.push({ code: 'work_mode', value: 'colour' })
  commands.push({ code, value: {
    h: clamp(Math.round(color.hue), 0, 360),
    s: Math.round(clamp(color.saturation, 0, 100) / 100 * colorMax(code)),
    v: Math.round(brightness / 100 * colorMax(code))
  } })
  return commands
}

export function isControllableBulb(status: TuyaStatusItem[], functions: TuyaFunction[] = []): boolean {
  return Boolean(pick(status, functions, 'switch_led'))
}

export function bulbCapabilities(status: TuyaStatusItem[], functions: TuyaFunction[] = []): { brightness: boolean; color: boolean; colorTemperature: boolean } {
  return {
    brightness: Boolean(pick(status, functions, 'bright_value_v2', 'bright_value')),
    color: Boolean(pick(status, functions, 'colour_data_v2', 'colour_data')),
    colorTemperature: Boolean(pick(status, functions, 'temp_value_v2', 'temp_value'))
  }
}

export function bulbModes(status: TuyaStatusItem[], functions: TuyaFunction[] = []): string[] {
  if (!pick(status, functions, 'work_mode')) return []
  const spec = safeJson(functions.find((item) => item.code === 'work_mode')?.values) as { range?: unknown } | null
  const range = Array.isArray(spec?.range) ? spec.range : ['white', 'colour']
  return ['white', 'colour'].filter((mode) => range.includes(mode))
}
