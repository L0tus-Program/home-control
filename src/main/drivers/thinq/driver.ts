import type { IClientOptions, MqttClient } from 'mqtt'
import type { Capability, Command, Device, DeviceState, EnergyReport, OptionKey, TimerAction } from '../../../shared/types'
import { LG_BROKER_DOMAINS, secureBrokerUrl } from '../../realtime/broker'
import { MqttLink } from '../../realtime/mqtt-link'
import { DriverError, type Driver, type RealtimeHandle, type RealtimeListener } from '../types'
import { ALREADY_SUBSCRIBED, ThinqClient, type ThinqDeviceListItem } from './client'
import { createCsr } from './csr'
import { mergeReport, parseThinqMessage } from './realtime'

export const THINQ_DRIVER_ID = 'thinq'

const AC_TYPE = 'DEVICE_AIR_CONDITIONER'

/** Onde o perfil guarda temperatura. A LG migrou de `temperature` para `temperatureInUnits`. */
const TEMPERATURE_RESOURCES = ['temperatureInUnits', 'temperature'] as const

/** Alvos de temperatura, do mais generico ao especifico por modo. */
const TARGET_KEYS = [
  'targetTemperature',
  'coolTargetTemperature',
  'heatTargetTemperature',
  'autoTargetTemperature'
] as const

type TargetKey = (typeof TARGET_KEYS)[number]

/** O modo em que o aparelho esta decide qual alvo de temperatura vale. */
const TARGET_FOR_MODE: Record<string, TargetKey> = {
  COOL: 'coolTargetTemperature',
  AIR_DRY: 'coolTargetTemperature',
  HEAT: 'heatTargetTemperature',
  AUTO: 'autoTargetTemperature'
}

interface PropertyDescriptor {
  type?: string
  mode?: string[]
  value?: { r?: unknown; w?: unknown }
}

interface RangeValues {
  min: number
  max: number
  step?: number
}

/** O que descobrimos do perfil e precisamos lembrar para montar comandos. */
interface AcLayout {
  modes: string[]
  fanKey?: string
  fanOptions: string[]
  tempResource?: string
  /** Alvos graváveis que este modelo expoe, em ordem de preferencia. */
  targets: Partial<Record<TargetKey, RangeValues>>
  /** Ajustes liga/desliga que o perfil declara como graváveis. */
  options: OptionKey[]
  /** Timers relativos (`timer.relativeHourToStart/Stop`) que o modelo aceita. */
  timers: TimerAction[]
  /** O perfil declara avisos (`notification.push`): so entao assinamos. */
  push: boolean
  /** Lido do perfil de energia, a parte; falso se o aparelho nao informa. */
  energy?: boolean
}

const ENERGY_PROPERTY = 'energyUsage'
/** Consumo muda devagar e cada leitura gasta cota da API: guardamos por um tempo. */
const ENERGY_CACHE_MS = 30 * 60 * 1000
/** Leitura incompleta ou com falha: tenta de novo bem antes, sem martelar a API. */
const ENERGY_RETRY_MS = 2 * 60 * 1000
/** Perfil de energia que falhou por rede ou cota: nova tentativa depois disso. */
const ENERGY_PROFILE_RETRY_MS = 10 * 60 * 1000
/** "Recurso nao existe neste modelo": resposta definitiva, nao falha passageira. */
const NOT_SUPPORTED_CODES = new Set(['1220', '2201', '1219', '1221'])

const pad = (value: number): string => String(value).padStart(2, '0')
const ymd = (date: Date): string => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
const ym = (date: Date): string => `${date.getFullYear()}${pad(date.getMonth() + 1)}`

/** `result.dataList[]` com o valor em `energyUsage` (Wh), como o SDK le. */
export function energyEntries(response: unknown): Array<{ date?: string; wh: number }> {
  const body = asRecord(response)
  const list = asRecord(body.result).dataList ?? body.dataList
  const items: unknown[] = Array.isArray(list) ? list : []
  return items.flatMap((item) => {
    const entry = asRecord(item)
    // Numero ou texto numerico; `totalEnergy` como reserva se a chave vier com outro nome.
    const raw = entry[ENERGY_PROPERTY] ?? entry.totalEnergy
    const wh = typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw
    if (typeof wh !== 'number' || !Number.isFinite(wh) || wh < 0) return []
    const day = [entry.usedDate, entry.date].find((value): value is string => typeof value === 'string' && /^\d{6,8}$/.test(value))
    const date = day && day.length === 8 ? `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}` : undefined
    return [{ ...(date ? { date } : {}), wh }]
  })
}

/** A LG programa timers relativos em horas e minutos; 24 h cobre o uso comum. */
const LG_TIMER_MAX_MINUTES = 24 * 60

/** Campos do recurso `timer` para cada acao. */
const TIMER_FIELDS: Record<TimerAction, { hour: string; minute: string; flag: string }> = {
  on: { hour: 'relativeHourToStart', minute: 'relativeMinuteToStart', flag: 'relativeStartTimer' },
  off: { hour: 'relativeHourToStop', minute: 'relativeMinuteToStop', flag: 'relativeStopTimer' }
}

/** Onde cada ajuste mora no perfil e no estado da ThinQ Connect. */
const OPTION_PATHS: Record<OptionKey, [resource: string, field: string]> = {
  powerSave: ['powerSave', 'powerSaveEnabled'],
  swingVertical: ['windDirection', 'rotateUpDown'],
  swingHorizontal: ['windDirection', 'rotateLeftRight']
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function descriptor(value: unknown): PropertyDescriptor | undefined {
  return value && typeof value === 'object' ? (value as PropertyDescriptor) : undefined
}

function isWritable(prop: PropertyDescriptor | undefined): boolean {
  return Boolean(prop?.mode?.includes('w'))
}

function writableOptions(prop: PropertyDescriptor | undefined): string[] {
  if (!isWritable(prop)) return []
  const values = prop?.value?.w
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : []
}

function writableRange(prop: PropertyDescriptor | undefined): RangeValues | undefined {
  if (!isWritable(prop)) return undefined
  const values = prop?.value?.w
  if (!values || typeof values !== 'object') return undefined
  const { min, max, step } = values as Partial<RangeValues>
  if (typeof min !== 'number' || typeof max !== 'number') return undefined
  return { min, max, step: typeof step === 'number' && step > 0 ? step : 1 }
}

/**
 * `temperatureInUnits` vem como lista, uma entrada por unidade. Pegamos Celsius.
 * Modelos antigos mandam um objeto unico — tratamos os dois casos.
 */
function celsiusBlock(property: Record<string, unknown>): {
  resource?: string
  block: Record<string, unknown>
} {
  for (const resource of TEMPERATURE_RESOURCES) {
    const raw = property[resource]
    if (Array.isArray(raw)) {
      const entry = raw.find((item) => asRecord(item).unit === 'C') ?? raw[0]
      if (entry) return { resource, block: asRecord(entry) }
    } else if (raw && typeof raw === 'object') {
      return { resource, block: asRecord(raw) }
    }
  }
  return { block: {} }
}

function readLayout(profile: Record<string, unknown>): AcLayout {
  const property = asRecord(profile.property)

  const jobMode = descriptor(asRecord(property.airConJobMode).currentJobMode)
  const airFlow = asRecord(property.airFlow)
  // Alguns modelos expoem uma escala detalhada no lugar da simples.
  const fanKey = ['windStrengthDetail', 'windStrength'].find((key) => key in airFlow)
  const fan = descriptor(fanKey ? airFlow[fanKey] : undefined)

  const { resource, block } = celsiusBlock(property)
  const targets: AcLayout['targets'] = {}
  for (const key of TARGET_KEYS) {
    const range = writableRange(descriptor(block[key]))
    if (range) targets[key] = range
  }

  const options = (Object.keys(OPTION_PATHS) as OptionKey[]).filter((key) => {
    const [resourceName, field] = OPTION_PATHS[key]
    const prop = descriptor(asRecord(property[resourceName])[field])
    // Precisa ser legivel (o botao mostra o estado) e aceitar ligar e desligar.
    const accepted = Array.isArray(prop?.value?.w) ? prop.value.w : []
    return isWritable(prop) && Boolean(prop?.mode?.includes('r')) && prop?.type === 'boolean' && accepted.includes(true) && accepted.includes(false)
  })

  const timer = asRecord(property.timer)
  // So entra o timer que o app consegue ver (flag SET legivel) e cancelar (UNSET gravavel).
  const timers = (['on', 'off'] as TimerAction[]).filter((action) => {
    const fields = TIMER_FIELDS[action]
    const flag = descriptor(timer[fields.flag])
    const readable = Array.isArray(flag?.value?.r) && flag.value.r.includes('SET')
    return isWritable(descriptor(timer[fields.hour])) && isWritable(descriptor(timer[fields.minute])) &&
      readable && writableOptions(flag).includes('UNSET')
  })

  return {
    modes: writableOptions(jobMode),
    fanKey,
    fanOptions: writableOptions(fan),
    tempResource: resource,
    targets,
    options,
    timers,
    push: Array.isArray(asRecord(profile.notification).push) && (asRecord(profile.notification).push as unknown[]).length > 0
  }
}

function readState(raw: Record<string, unknown>, layout: AcLayout): DeviceState {
  const operation = asRecord(raw.operation)
  const jobMode = asRecord(raw.airConJobMode)
  const airFlow = asRecord(raw.airFlow)

  const { block } = celsiusBlock({ ...raw, property: undefined })
  const temperatures = pickTemperatureReadings(raw) ?? block

  const mode = typeof jobMode.currentJobMode === 'string' ? jobMode.currentJobMode : undefined
  const targetKey = resolveTargetKey(layout, mode)

  const numeric = (value: unknown): number | undefined =>
    typeof value === 'number' ? value : undefined

  return {
    // Nem todo modelo publica o estado de energia como leitura; aí assumimos desligado
    // até o aparelho dizer o contrário.
    online: true,
    power: operation.airConOperationMode === 'POWER_ON',
    temperature: numeric(temperatures[targetKey]) ?? numeric(temperatures.targetTemperature),
    currentTemperature: numeric(temperatures.currentTemperature),
    mode,
    fan:
      layout.fanKey && typeof airFlow[layout.fanKey] === 'string'
        ? (airFlow[layout.fanKey] as string)
        : undefined,
    humidity: numeric(asRecord(raw.airQualitySensor).humidity),
    ...readOptions(raw, layout),
    ...readTimers(raw, layout),
    ...readAirQuality(asRecord(raw.airQualitySensor)),
    ...readFilter(asRecord(raw.filterInfo))
  }
}

/** `relativeStopTimer: SET` com horas e minutos restantes; sem os numeros, prazo desconhecido (0). */
function readTimers(raw: Record<string, unknown>, layout: AcLayout): Pick<DeviceState, 'timer'> {
  const timer = asRecord(raw.timer)
  const result: Partial<Record<TimerAction, number>> = {}
  for (const action of layout.timers) {
    const fields = TIMER_FIELDS[action]
    if (timer[fields.flag] !== 'SET') continue
    const hour = timer[fields.hour]
    const minute = timer[fields.minute]
    result[action] = typeof hour === 'number' || typeof minute === 'number'
      ? Math.max(0, (typeof hour === 'number' ? hour : 0) * 60 + (typeof minute === 'number' ? minute : 0))
      : 0
  }
  return Object.keys(result).length > 0 ? { timer: result } : {}
}

/** Filtro: horas de uso e, quando informado, a vida util ou o que resta. Zero na vida util = desconhecida. */
function readFilter(info: Record<string, unknown>): Pick<DeviceState, 'filter'> {
  const positive = (value: unknown, allowZero = false): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) ? value : undefined
  const filter = {
    usedHours: positive(info.usedTime, true),
    lifetimeHours: positive(info.filterLifetime),
    remainingPercent: typeof info.filterRemainPercent === 'number' && info.filterRemainPercent >= 0 && info.filterRemainPercent <= 100 ? info.filterRemainPercent : undefined
  }
  const present = Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined))
  return Object.keys(present).length > 0 ? { filter: present } : {}
}

/** Texto dos avisos (`pushCode`); so os confirmados no perfil real. O resto vai com o codigo. */
const PUSH_MESSAGES: Record<string, string> = {
  WATER_IS_FULL: 'O reservatório de água está cheio.'
}

export function pushMessage(code: string | undefined): string {
  if (code && PUSH_MESSAGES[code]) return PUSH_MESSAGES[code]
  return code ? `O aparelho enviou um aviso (${code}).` : 'O aparelho enviou um aviso.'
}

/** Aviso mais velho que isso e reentrega da sessao persistente, nao novidade. */
const NOTICE_MAX_AGE_MS = 10 * 60 * 1000
/** O mesmo aviso do mesmo aparelho nao se repete nesse intervalo. */
const NOTICE_COOLDOWN_MS = 30 * 60 * 1000

/** Apelido para notificacao: curto e sem caracteres de controle. */
function noticeTitle(name: string): string {
  const clean = name.replace(/[\p{C}]/gu, ' ').replace(/\s+/g, ' ').trim()
  return (clean.length > 80 ? `${clean.slice(0, 79)}…` : clean) || 'Aparelho LG'
}

/** Sensor de particulas: so os valores que o modelo publica. */
function readAirQuality(sensor: Record<string, unknown>): Pick<DeviceState, 'airQuality'> {
  const value = (key: string): number | undefined => {
    const raw = sensor[key]
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : undefined
  }
  const quality = { pm1: value('PM1'), pm25: value('PM2'), pm10: value('PM10') }
  const present = Object.fromEntries(Object.entries(quality).filter(([, v]) => v !== undefined))
  return Object.keys(present).length > 0 ? { airQuality: present } : {}
}

function readOptions(raw: Record<string, unknown>, layout: AcLayout): Pick<DeviceState, 'options'> {
  const options: Partial<Record<OptionKey, boolean>> = {}
  for (const key of layout.options) {
    const [resourceName, field] = OPTION_PATHS[key]
    const value = asRecord(raw[resourceName])[field]
    if (typeof value === 'boolean') options[key] = value
  }
  return Object.keys(options).length > 0 ? { options } : {}
}

/** No estado, as temperaturas vem numa lista por unidade, igual ao perfil. */
function pickTemperatureReadings(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  for (const resource of TEMPERATURE_RESOURCES) {
    const value = raw[resource]
    if (Array.isArray(value)) {
      const entry = value.find((item) => asRecord(item).unit === 'C') ?? value[0]
      if (entry) return asRecord(entry)
    } else if (value && typeof value === 'object') {
      return asRecord(value)
    }
  }
  return undefined
}

function resolveTargetKey(layout: AcLayout, mode: string | undefined): TargetKey {
  const preferred = mode ? TARGET_FOR_MODE[mode.toUpperCase()] : undefined
  if (preferred && layout.targets[preferred]) return preferred
  if (layout.targets.targetTemperature) return 'targetTemperature'
  const first = TARGET_KEYS.find((key) => layout.targets[key])
  return first ?? 'targetTemperature'
}

function buildCapabilities(layout: AcLayout): Capability[] {
  const capabilities: Capability[] = [{ kind: 'power' }]

  const ranges = Object.values(layout.targets)
  if (ranges.length > 0) {
    // A faixa mostrada na UI cobre todos os alvos que o modelo aceita.
    capabilities.push({
      kind: 'temperature',
      min: Math.min(...ranges.map((r) => r.min)),
      max: Math.max(...ranges.map((r) => r.max)),
      step: Math.min(...ranges.map((r) => r.step ?? 1))
    })
  }
  if (layout.modes.length > 0) capabilities.push({ kind: 'mode', options: layout.modes })
  if (layout.fanOptions.length > 0) capabilities.push({ kind: 'fan', options: layout.fanOptions })
  for (const key of layout.options) capabilities.push({ kind: 'option', key })
  if (layout.energy === true) capabilities.push({ kind: 'energy' })
  if (layout.timers.length > 0) capabilities.push({ kind: 'timer', actions: layout.timers, maxMinutes: LG_TIMER_MAX_MINUTES })
  return capabilities
}

/** Chave e certificado do MQTT; guardados no cofre para nao emitir um a cada abertura. */
export interface ThinqMqttCredentials {
  clientId: string
  privateKeyPem: string
  certificatePem: string
  subscriptions: string[]
}

export interface ThinqRealtimeOptions {
  loadCredentials?: (clientId: string) => ThinqMqttCredentials | null
  saveCredentials?: (credentials: ThinqMqttCredentials | null) => void
  connect?: (url: string, options: IClientOptions) => MqttClient
}

/** Token invalido, conta errada, pais sem suporte: reconectar nao resolve. */
const FATAL_CODES = new Set(['1103', '1218', '1302', '1303', '1307'])
/** A assinatura de eventos expira (4464 h); o SDK oficial renova uma vez por dia. */
const RESUBSCRIBE_MS = 24 * 60 * 60 * 1000
const REREAD_DELAY_MS = 1500
const REREAD_MIN_INTERVAL_MS = 10_000
const RESUBSCRIBE_AFTER_CHANGE_MS = 5000
/** Assinatura que falhou (cota, rede) e tentada de novo bem antes da renovacao diaria. */
const SUBSCRIBE_RETRY_MS = 5 * 60 * 1000
const ROUTE_TTL_MS = 10 * 60 * 1000
const REISSUE_MIN_INTERVAL_MS = 10 * 60 * 1000

/**
 * O broker recusou o certificado: CONNACK 4/5 (MQTT 3.1.1), 134/135 (MQTT 5)
 * ou falha no aperto de mao TLS. Rede caida, DNS e porta bloqueada nao contam.
 */
export function isCredentialRefusal(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false
  const code = (cause as { code?: unknown }).code
  if (typeof code === 'number' && [4, 5, 134, 135].includes(code)) return true
  if (typeof code === 'string' && /^ERR_SSL_/.test(code)) return true
  return /not authori[sz]ed|bad user ?name or password|certificate|handshake|alert/i.test(cause.message)
}

function errorCode(cause: unknown): string {
  return cause instanceof Error ? String((cause as { code?: unknown }).code ?? '') : ''
}

export class ThinqDriver implements Driver {
  readonly id = THINQ_DRIVER_ID
  readonly label = 'LG ThinQ'

  /** Perfis quase nunca mudam; buscar a cada refresh so queima cota da API. */
  private readonly layouts = new Map<string, AcLayout>()
  /** Por aparelho: a leitura (em andamento ou pronta), o dia a que se refere e ate quando vale. */
  private readonly energy = new Map<string, { day: string; until: number; report: Promise<EnergyReport> }>()
  private readonly energyProfileTried = new Map<string, number>()
  /** Ultimo estado bruto e ficha de cada ar; base para os relatos parciais do MQTT. */
  private readonly known = new Map<string, { item: ThinqDeviceListItem; raw: Record<string, unknown>; rev: number; at: number }>()
  /** Contador que so cresce: a protecao contra leitura atrasada sobrevive a remocoes do cache. */
  private revision = 0

  constructor(
    private readonly client: ThinqClient | null,
    private readonly realtime: ThinqRealtimeOptions = {}
  ) {}

  isConfigured(): boolean {
    return this.client !== null
  }

  private requireClient(): ThinqClient {
    if (!this.client) {
      throw new DriverError('Integracao LG sem token. Configure nas preferencias.')
    }
    return this.client
  }

  async listDevices(): Promise<Device[]> {
    const client = this.requireClient()
    const startedAt = Date.now()
    const items = (await client.listDevices()) ?? []
    const ids = new Set(items.map((item) => item.deviceId))
    for (const [id, entry] of this.known) if (!ids.has(id) && entry.at < startedAt) this.known.delete(id)
    return Promise.all(items.map((item) => this.hydrate(item)))
  }

  async getDevice(deviceId: string): Promise<Device> {
    const client = this.requireClient()
    // Ficha ja conhecida: so o estado precisa vir da nuvem, sem relistar a conta.
    // A falha de leitura sobe: "offline e desligado" nao pode passar por confirmacao.
    const cached = this.known.get(deviceId)?.item
    if (cached) return this.read(cached)
    const items = (await client.listDevices()) ?? []
    const item = items.find((entry) => entry.deviceId === deviceId)
    if (!item) throw new DriverError('Aparelho nao encontrado na conta LG.')
    return this.hydrate(item)
  }

  private base(item: ThinqDeviceListItem): Device {
    const info = item.deviceInfo ?? {}
    const name = info.alias?.trim() || info.modelName || 'Aparelho LG'
    const base: Device = {
      id: item.deviceId,
      driverId: this.id,
      name,
      model: info.modelName,
      kind: info.deviceType === AC_TYPE ? 'air-conditioner' : 'unknown',
      capabilities: [],
      state: { online: false, power: false }
    }
    return base
  }

  private build(item: ThinqDeviceListItem, layout: AcLayout, raw: Record<string, unknown>): Device {
    return { ...this.base(item), capabilities: buildCapabilities(layout), state: readState(raw, layout) }
  }

  private async hydrate(item: ThinqDeviceListItem): Promise<Device> {
    const base = this.base(item)

    // Por ora so o ar-condicionado tem controles. Os outros aparecem listados.
    if (base.kind !== 'air-conditioner') return base

    try {
      return await this.read(item)
    } catch (cause) {
      // Um aparelho offline nao pode derrubar a lista inteira.
      return { ...base, state: { online: false, power: false } }
    }
  }

  /** Le o estado do ar; lanca em falha. */
  private async read(item: ThinqDeviceListItem): Promise<Device> {
    const rev = this.known.get(item.deviceId)?.rev ?? 0
    const layout = await this.layoutFor(item.deviceId)
    const raw = asRecord(await this.requireClient().getState(item.deviceId))
    const current = this.known.get(item.deviceId)
    // Um relato do MQTT chegou durante a leitura: ele é mais novo que ela.
    if (current && current.rev !== rev) {
      current.item = item
      return this.build(item, layout, current.raw)
    }
    this.known.set(item.deviceId, { item, raw, rev, at: Date.now() })
    return this.build(item, layout, raw)
  }

  private async layoutFor(deviceId: string): Promise<AcLayout> {
    const cached = this.layouts.get(deviceId)
    const layout = cached ?? readLayout(await this.requireClient().getProfile(deviceId))
    if (!cached) this.layouts.set(deviceId, layout)
    await this.probeEnergy(deviceId, layout)
    return layout
  }

  /**
   * Perfil de energia a parte. Resposta sem `energyUsage` ou "nao suportado" e
   * definitivo; falha de rede ou cota deixa indefinido e tenta de novo depois.
   */
  private async probeEnergy(deviceId: string, layout: AcLayout): Promise<void> {
    if (layout.energy !== undefined) return
    const tried = this.energyProfileTried.get(deviceId)
    if (tried !== undefined && Date.now() - tried < ENERGY_PROFILE_RETRY_MS) return
    this.energyProfileTried.set(deviceId, Date.now())
    try {
      const response = asRecord(await this.requireClient().getEnergyProfile(deviceId))
      const properties = asRecord(response.result ?? response).property
      layout.energy = Array.isArray(properties) ? properties.includes(ENERGY_PROPERTY) : ENERGY_PROPERTY in asRecord(properties)
    } catch (cause) {
      if (NOT_SUPPORTED_CODES.has(errorCode(cause))) layout.energy = false
    }
  }

  /** Ultimos 7 dias, este mes e o anterior, em Wh. Uma leitura por vez por aparelho. */
  getEnergy(deviceId: string): Promise<EnergyReport> {
    // So aparelhos ja listados: o id vem do renderer e vira caminho de requisicao autenticada.
    if (!this.layouts.has(deviceId) && !this.known.has(deviceId)) {
      return Promise.reject(new DriverError('Aparelho nao encontrado na conta LG.'))
    }
    const today = ymd(new Date())
    const cached = this.energy.get(deviceId)
    if (cached && cached.day === today && Date.now() < cached.until) return cached.report
    const report = this.readEnergy(deviceId)
    const entry = { day: today, until: Date.now() + ENERGY_CACHE_MS, report }
    this.energy.set(deviceId, entry)
    // Falha ou leitura incompleta valem pouco tempo no cache.
    report.then((value) => {
      if (value.thisMonthWh === undefined || value.lastMonthWh === undefined) entry.until = Date.now() + ENERGY_RETRY_MS
    }, () => { entry.until = Date.now() + ENERGY_RETRY_MS })
    return report
  }

  private async readEnergy(deviceId: string): Promise<EnergyReport> {
    const client = this.requireClient()
    const layout = await this.layoutFor(deviceId)
    if (layout.energy === false) throw new DriverError('Este aparelho nao informa o consumo de energia.')
    if (layout.energy === undefined) throw new DriverError('Nao consegui ler o consumo agora. Tente de novo em instantes.')
    const today = new Date()
    const weekAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const month = (date: Date): Promise<number | undefined> =>
      client.getEnergyUsage(deviceId, ENERGY_PROPERTY, 'MONTHLY', ym(date), ym(date))
        .then((response) => {
          const entries = energyEntries(response)
          return entries.length > 0 ? entries.reduce((sum, entry) => sum + entry.wh, 0) : undefined
        }, () => undefined)
    const [daily, thisMonthWh, lastMonthWh] = await Promise.all([
      client.getEnergyUsage(deviceId, ENERGY_PROPERTY, 'DAILY', ymd(weekAgo), ymd(today)).then(energyEntries),
      month(today),
      month(lastMonth)
    ])
    const days = new Map<string, number>()
    for (const entry of daily) if (entry.date) days.set(entry.date, entry.wh)
    return {
      days: [...days].map(([date, wh]) => ({ date, wh })).sort((x, y) => x.date.localeCompare(y.date)),
      ...(thisMonthWh === undefined ? {} : { thisMonthWh }),
      ...(lastMonthWh === undefined ? {} : { lastMonthWh })
    }
  }

  async execute(deviceId: string, command: Command): Promise<void> {
    const client = this.requireClient()
    const layout = await this.layoutFor(deviceId)

    switch (command.type) {
      case 'power':
        await client.control(deviceId, {
          operation: { airConOperationMode: command.value ? 'POWER_ON' : 'POWER_OFF' }
        })
        return

      case 'mode':
        await client.control(deviceId, { airConJobMode: { currentJobMode: command.value } })
        return

      case 'fan': {
        if (!layout.fanKey) throw new DriverError('Este modelo nao deixa ajustar a ventilacao.')
        await client.control(deviceId, { airFlow: { [layout.fanKey]: command.value } })
        return
      }

      case 'temperature': {
        if (!layout.tempResource || Object.keys(layout.targets).length === 0) {
          throw new DriverError('Este modelo nao deixa ajustar a temperatura.')
        }
        // Precisamos do modo atual para saber qual alvo o aparelho vai aceitar.
        const state = await client.getState(deviceId)
        const mode = asRecord(asRecord(state).airConJobMode).currentJobMode
        const key = resolveTargetKey(layout, typeof mode === 'string' ? mode : undefined)
        await client.control(deviceId, {
          [layout.tempResource]: { [key]: command.value, unit: 'C' }
        })
        return
      }

      case 'timer': {
        if (!layout.timers.includes(command.action)) throw new DriverError('Este modelo nao tem esse timer.')
        const fields = TIMER_FIELDS[command.action]
        if (command.minutes === null) {
          await client.control(deviceId, { timer: { [fields.flag]: 'UNSET' } })
          return
        }
        const minutes = Math.round(command.minutes)
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > LG_TIMER_MAX_MINUTES) throw new DriverError('Prazo de timer invalido.')
        // Ligar programado so com o ar desligado; desligar programado so com ele ligado.
        const power = asRecord(asRecord(await client.getState(deviceId)).operation).airConOperationMode === 'POWER_ON'
        if ((command.action === 'off') !== power) {
          throw new DriverError(power ? 'O ar ja esta ligado.' : 'O ar ja esta desligado.')
        }
        const hour = Math.floor(minutes / 60)
        const minute = minutes % 60
        // Como o SDK oficial: no desligar, minuto zero vai omitido.
        const body = command.action === 'off' && minute === 0 ? { [fields.hour]: hour } : { [fields.hour]: hour, [fields.minute]: minute }
        await client.control(deviceId, { timer: body })
        return
      }

      case 'option': {
        if (!layout.options.includes(command.key)) throw new DriverError('Este modelo nao tem esse ajuste.')
        const [resourceName, field] = OPTION_PATHS[command.key]
        await client.control(deviceId, { [resourceName]: { [field]: command.value } })
        return
      }

      default:
        throw new DriverError(`Comando nao suportado pela LG: ${(command as Command).type}`)
    }
  }

  /** Tempo real pelo MQTT oficial (AWS IoT com certificado do cliente). */
  async watch(listener: RealtimeListener): Promise<RealtimeHandle> {
    const client = this.requireClient()
    let stopped = false
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const later = (key: string, delay: number, run: () => void): void => {
      if (stopped || timers.has(key)) return
      timers.set(key, setTimeout(() => { timers.delete(key); run() }, delay))
    }
    const lastReread = new Map<string, number>()
    const reread = (id: string): void => {
      const wait = Math.max(REREAD_DELAY_MS, (lastReread.get(id) ?? -Infinity) + REREAD_MIN_INTERVAL_MS - Date.now())
      later(`reread:${id}`, wait, () => {
        lastReread.set(id, Date.now())
        this.getDevice(id).then((device) => listener.event({ type: 'state', device }), () => undefined)
      })
    }

    let credentials: ThinqMqttCredentials | null = null
    /** Quando o certificado em uso foi emitido nesta sessao; nunca reemite em seguida. */
    let issuedAt = 0
    let credentialFailures = 0
    let registered = false
    let route: { url: string; at: number } | null = null
    let subscribed = false
    const lastNotice = new Map<string, number>()

    /**
     * Assina eventos dos ares da conta (inclusive os offline agora) e a lista de
     * aparelhos. "Ja assinado" e sucesso; outra falha fica pendente e e tentada
     * de novo em minutos. Assinar nunca impede a conexao; so token ou conta
     * invalidos interrompem.
     */
    const subscribe = async (): Promise<void> => {
      // Base para os relatos parciais; a UI normalmente ja leu, mas o canal pode vir antes.
      if (this.known.size === 0) await this.listDevices()
      const items = (await client.listDevices()) ?? []
      let pending = false
      const attempt = async (run: () => Promise<unknown>): Promise<void> => {
        try {
          await run()
        } catch (cause) {
          if (FATAL_CODES.has(errorCode(cause))) throw cause
          if (!ALREADY_SUBSCRIBED.has(errorCode(cause))) pending = true
        }
      }
      for (const item of items) {
        if (stopped) return
        if (item.deviceInfo?.deviceType !== AC_TYPE) continue
        await attempt(() => client.subscribeEvents(item.deviceId))
        // Avisos sao um extra: so para quem declara, e falha nao deixa nada pendente.
        if (this.layouts.get(item.deviceId)?.push) {
          await client.subscribePush(item.deviceId).catch((cause) => { if (FATAL_CODES.has(errorCode(cause))) throw cause })
        }
      }
      await attempt(() => client.subscribeDeviceList())
      subscribed = !pending
      if (pending) later('subscribe', SUBSCRIBE_RETRY_MS, () => { void subscribe().catch(() => undefined) })
    }

    const issue = async (): Promise<ThinqMqttCredentials> => {
      const { csr, privateKeyPem } = await createCsr()
      if (stopped) throw new DriverError('Tempo real encerrado.')
      const issued = await client.issueCertificate(csr)
      const body = asRecord(issued.result ?? issued)
      const subscriptions = Array.isArray(body.subscriptions) ? body.subscriptions.filter((topic): topic is string => typeof topic === 'string') : []
      if (typeof body.certificatePem !== 'string' || subscriptions.length === 0) {
        throw new DriverError('A LG não emitiu o certificado do tempo real.')
      }
      return { clientId: client.clientId, privateKeyPem, certificatePem: body.certificatePem, subscriptions }
    }

    const link: MqttLink = new MqttLink({
      prepare: async (lastError) => {
        // Registro e rota uma vez por sessao: falha so do MQTT nao gasta REST a cada tentativa.
        if (!registered) {
          await client.registerClient()
          registered = true
        }
        if (!route || Date.now() - route.at > ROUTE_TTL_MS) {
          const response = await client.getRoute()
          route = { url: secureBrokerUrl(response?.mqttServer, LG_BROKER_DOMAINS), at: Date.now() }
        }
        if (stopped) throw new DriverError('Tempo real encerrado.')

        credentials ??= this.realtime.loadCredentials?.(client.clientId) ?? null
        // Reemite so quando o broker recusou o certificado: na primeira recusa de um
        // certificado vindo do cofre, ou depois de varias seguidas. Nunca logo apos emitir.
        if (lastError !== undefined && isCredentialRefusal(lastError)) credentialFailures++
        const recentlyIssued = Date.now() - issuedAt < REISSUE_MIN_INTERVAL_MS
        if (credentials && !recentlyIssued && (credentialFailures >= 3 || (credentialFailures >= 1 && issuedAt === 0 && link.connectedNever()))) {
          credentials = null
        }
        if (!credentials) {
          const fresh = await issue()
          // O token pode ter sido removido durante a emissao: nada volta ao cofre.
          if (stopped) throw new DriverError('Tempo real encerrado.')
          credentials = fresh
          issuedAt = Date.now()
          credentialFailures = 0
          this.realtime.saveCredentials?.(fresh)
        }
        if (!subscribed) await subscribe()
        return {
          url: route.url,
          options: { clientId: client.clientId, key: credentials.privateKeyPem, cert: credentials.certificatePem, protocolVersion: 4, clean: false, keepalive: 60 },
          topics: credentials.subscriptions
        }
      },
      message: (_topic, payload, redelivered) => {
        let raw: unknown
        try { raw = JSON.parse(payload.toString('utf8')) } catch { return }
        const message = parseThinqMessage(raw)
        if (!message) return
        if (message.kind === 'changed') {
          listener.event({ type: 'refresh' })
          // Aparelho novo precisa da propria assinatura de eventos.
          later('subscribe', RESUBSCRIBE_AFTER_CHANGE_MS, () => {
            void this.listDevices().then(() => subscribe()).catch(() => undefined)
          })
          return
        }
        if (message.kind === 'push') {
          // Sessao persistente (clean: false) reentrega avisos antigos ao reconectar.
          if (redelivered || (message.at !== undefined && Date.now() - message.at > NOTICE_MAX_AGE_MS)) return
          const key = `${message.deviceId}:${message.code ?? ''}`
          const last = lastNotice.get(key)
          if (last !== undefined && Date.now() - last < NOTICE_COOLDOWN_MS) return
          lastNotice.set(key, Date.now())
          const item = this.known.get(message.deviceId)?.item
          const title = noticeTitle(item ? this.base(item).name : 'Aparelho LG')
          listener.event({ type: 'notice', deviceId: message.deviceId, title, message: pushMessage(message.code) })
          return
        }
        const entry = this.known.get(message.deviceId)
        const layout = this.layouts.get(message.deviceId)
        if (!entry || !layout) {
          reread(message.deviceId)
          return
        }
        credentialFailures = 0
        if ('operation' in message.report && !('timer' in message.report) && 'timer' in entry.raw) reread(message.deviceId)
        entry.raw = mergeReport(entry.raw, message.report)
        entry.rev = ++this.revision
        listener.event({ type: 'state', device: this.build(entry.item, layout, entry.raw) })
      },
      status: (state, error) => {
        if (state === 'live') credentialFailures = 0
        listener.status(state, error)
      },
      reconnected: () => listener.event({ type: 'refresh' }),
      isFatal: (cause) => FATAL_CODES.has(errorCode(cause)),
      ...(this.realtime.connect ? { connect: this.realtime.connect } : {})
    })

    const renew = setInterval(() => { void subscribe().catch(() => undefined) }, RESUBSCRIBE_MS)
    link.start()
    return {
      stop: async () => {
        stopped = true
        clearInterval(renew)
        for (const timer of timers.values()) clearTimeout(timer)
        timers.clear()
        await link.stop()
      }
    }
  }
}
