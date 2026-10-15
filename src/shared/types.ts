/**
 * Modelo de dispositivo comum a todos os drivers.
 *
 * Cada integração (LG ThinQ ou Tuya) traduz o
 * protocolo dela para estas estruturas. A interface nunca fala ThinQ.
 */

export type DeviceKind = 'air-conditioner' | 'light' | 'unknown'

/** Timer que roda no proprio aparelho: ligar ou desligar depois de um tempo. */
export type TimerAction = 'on' | 'off'

/** Ajustes liga/desliga do aparelho, alem da energia. */
export type OptionKey = 'powerSave' | 'swingVertical' | 'swingHorizontal'

/** O que um aparelho aceita. A UI desenha os controles a partir disto. */
export type Capability =
  | { kind: 'power' }
  | { kind: 'temperature'; min: number; max: number; step: number }
  | { kind: 'mode'; options: string[] }
  | { kind: 'fan'; options: string[] }
  | { kind: 'brightness'; min: number; max: number }
  | { kind: 'color' }
  /** Tom do branco: 0 e o mais quente, 100 o mais frio. */
  | { kind: 'colorTemperature' }
  | { kind: 'option'; key: OptionKey }
  /** `actions`: o que o timer sabe fazer; `maxMinutes`: o maior prazo aceito. */
  | { kind: 'timer'; actions: TimerAction[]; maxMinutes: number }
  /** O aparelho informa consumo de energia (lido sob demanda). */
  | { kind: 'energy' }

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
  /** Tom do branco, 0 (quente) a 100 (frio). */
  colorTemperature?: number
  options?: Partial<Record<OptionKey, boolean>>
  /** Minutos que faltam para cada timer programado; 0 = programado, prazo desconhecido. */
  timer?: Partial<Record<TimerAction, number>>
  /** Filtro do ar: horas de uso e, quando o modelo informa, o que resta. */
  filter?: { usedHours?: number; lifetimeHours?: number; remainingPercent?: number }
  /** Particulas no ar (ug/m3), quando o aparelho tem sensor. */
  airQuality?: { pm1?: number; pm25?: number; pm10?: number }
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
  | { type: 'colorTemperature'; value: number }
  | { type: 'option'; key: OptionKey; value: boolean }
  /** `minutes` null cancela o timer. */
  | { type: 'timer'; action: TimerAction; minutes: number | null }

/** Consumo em watt-hora, como a fabricante informa. */
export interface EnergyReport {
  /** Ultimos dias, do mais antigo ao mais recente; `date` em AAAA-MM-DD. */
  days: Array<{ date: string; wh: number }>
  thisMonthWh?: number
  lastMonthWh?: number
}

export interface DriverStatus {
  id: string
  label: string
  configured: boolean
  /** Ultima falha de comunicacao, se houver. */
  error?: string
  /** Canal de atualizacao em tempo real; ausente quando a integracao nao tem. */
  realtime?: RealtimeStatus
}

/**
 * `off`: integracao sem tempo real ou sem conta. `connecting`: tentando.
 * `live`: recebendo eventos. `unavailable`: desistiu por ora; o app segue
 * atualizando como sem tempo real.
 */
export type RealtimeState = 'off' | 'connecting' | 'live' | 'unavailable'

export interface RealtimeStatus {
  state: RealtimeState
  error?: string
}

/** O que um driver avisa em tempo real, ja traduzido para o modelo comum. */
export type DeviceEvent =
  | { type: 'state'; device: Device }
  | { type: 'availability'; deviceId: string; online: boolean }
  /** Algo mudou que pede reler a lista: aparelho novo, removido, renomeado ou eventos perdidos. */
  | { type: 'refresh' }
  /** Aviso do proprio aparelho (reservatorio cheio, filtro), ja em texto para a pessoa. */
  | { type: 'notice'; deviceId: string; title: string; message: string }

/** Eventos de um driver, agrupados pelo processo principal antes de cruzar o IPC. */
export interface DeviceEventBatch {
  driverId: string
  events: DeviceEvent[]
}

export interface ThinqSettings {
  country: string
  /** Nunca trafega o token em si, so se ele existe. */
  hasToken: boolean
}

export interface TuyaSettings {
  region: string
  /** Nunca trafega as credenciais em si, só se existem. */
  hasCredentials: boolean
  connection?: 'qr' | 'cloud' | null
  userCode?: string
}

export interface AppSettings {
  thinq: ThinqSettings
  tuya: TuyaSettings
}

export type TuyaQrCheck =
  | { status: 'waiting' }
  | { status: 'expired' }
  | { status: 'connected'; settings: AppSettings }

/** Resultado de qualquer chamada vinda da UI: erro nunca derruba o app. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }
