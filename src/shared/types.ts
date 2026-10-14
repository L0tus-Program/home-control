/**
 * Modelo de dispositivo comum a todos os drivers.
 *
 * A ideia: cada integracao (LG ThinQ hoje, Elgin/Tuya depois) traduz o
 * protocolo dela para estas estruturas. A interface nunca fala ThinQ.
 */

export type DeviceKind = 'air-conditioner' | 'light' | 'unknown'

/** O que um aparelho aceita. A UI desenha os controles a partir disto. */
export type Capability =
  | { kind: 'power' }
  | { kind: 'temperature'; min: number; max: number; step: number }
  | { kind: 'mode'; options: string[] }
  | { kind: 'fan'; options: string[] }
  | { kind: 'brightness'; min: number; max: number }
  | { kind: 'color' }

export type CapabilityKind = Capability['kind']

/** Matiz e saturacao em graus/porcento. O brilho mora separado, em DeviceState. */
export interface ColorState {
  hue: number
  saturation: number
}

export interface DeviceState {
  online: boolean
  power: boolean
  /** Alvo de temperatura, em Celsius. */
  temperature?: number
  /** Temperatura ambiente lida pelo aparelho, em Celsius. */
  currentTemperature?: number
  mode?: string
  fan?: string
  brightness?: number
  color?: ColorState
  humidity?: number
}

export interface Device {
  id: string
  driverId: string
  name: string
  model?: string
  kind: DeviceKind
  capabilities: Capability[]
  state: DeviceState
}

/** Um comando que a UI manda para qualquer aparelho. */
export type Command =
  | { type: 'power'; value: boolean }
  | { type: 'temperature'; value: number }
  | { type: 'mode'; value: string }
  | { type: 'fan'; value: string }
  | { type: 'brightness'; value: number }
  | { type: 'color'; value: ColorState }

export interface DriverStatus {
  id: string
  label: string
  configured: boolean
  /** Ultima falha de comunicacao, se houver. */
  error?: string
}

export interface ThinqSettings {
  country: string
  /** Nunca trafega o token em si, so se ele existe. */
  hasToken: boolean
}

export interface AppSettings {
  thinq: ThinqSettings
}

/** Resultado de qualquer chamada vinda da UI: erro nunca derruba o app. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
