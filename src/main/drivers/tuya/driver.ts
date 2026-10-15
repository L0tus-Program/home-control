import type { IClientOptions, MqttClient } from 'mqtt'
import type { Capability, Command, Device } from '../../../shared/types'
import { secureBrokerUrl, TUYA_BROKER_DOMAINS } from '../../realtime/broker'
import { MqttLink } from '../../realtime/mqtt-link'
import { DriverError, type Driver, type RealtimeHandle, type RealtimeListener } from '../types'
import { brightnessCommand, bulbCapabilities, bulbModes, colorCommands, colorTemperatureCommands, countdownCommand, countdownMaxMinutes, hasCountdown, isControllableBulb, powerCommand, readState } from './bulb'
import type { TuyaApiDevice, TuyaFunction, TuyaStatusItem, TuyaCommand } from './cloud'
import { mergeStatus, parseTuyaMessage, resolveReport } from './realtime'
import type { TuyaMqttConfig } from './sharing'

/** Cloud de projeto e compartilhamento QR entregam o mesmo modelo ao driver. */
export interface TuyaApi {
  listDevices(): Promise<TuyaApiDevice[]>
  getDevice(id: string): Promise<TuyaApiDevice>
  getStatus(id: string): Promise<TuyaStatusItem[]>
  getFunctions(id: string): Promise<{ functions: TuyaFunction[] }>
  sendCommands(id: string, commands: TuyaCommand[]): Promise<void>
  /** Só a conexão por QR Code tem tempo real. */
  listHomeIds?(): Promise<string[]>
  getMqttConfig?(): Promise<TuyaMqttConfig>
}

export const TUYA_DRIVER_ID = 'tuya'
const LIGHT_CATEGORIES = new Set(['dj', 'dc', 'dd', 'xdd', 'fwd', 'tgq'])
/** Sessão QR removida ou vencida: reconectar não adianta, só um novo QR Code. */
const FATAL_CODES = new Set(['1010', '1011', '1012', '1106'])
/** Relatos que não sabemos traduzir viram uma leitura pela nuvem, no máximo uma por intervalo. */
const REREAD_DELAY_MS = 1000
const REREAD_MIN_INTERVAL_MS = 10_000
/** Aparelho entrou ou saiu: os tópicos mudam, então a conexão é refeita. */
const TOPOLOGY_RESTART_MS = 3000

interface Known {
  info: TuyaApiDevice
  status: TuyaStatusItem[]
  /** Sobe a cada relato do MQTT; uma leitura REST que começou antes não sobrescreve. */
  rev: number
  /** Quando entrou no cache; uma listagem mais velha não o remove. */
  at: number
}

/** Integração oficial Tuya Cloud, independente de LG ThinQ. */
export class TuyaDriver implements Driver {
  readonly id = TUYA_DRIVER_ID
  readonly label = 'Tuya'
  private functions = new Map<string, TuyaFunction[]>()
  /** Última leitura de cada lâmpada; base para aplicar os relatos parciais do MQTT. */
  private known = new Map<string, Known>()
  private listing: Promise<Device[]> | null = null
  /** Contador que só cresce: a proteção contra leitura atrasada sobrevive a remoções do cache. */
  private revision = 0

  constructor(
    private readonly cloud: TuyaApi | null,
    private readonly connectMqtt?: (url: string, options: IClientOptions) => MqttClient
  ) {}
  isConfigured(): boolean { return this.cloud !== null }

  private requireCloud(): TuyaApi {
    if (!this.cloud) throw new DriverError('Configure a integração Tuya para conectar seus aparelhos.')
    return this.cloud
  }

  private async getFunctions(id: string): Promise<TuyaFunction[]> {
    const cached = this.functions.get(id)
    if (cached) return cached
    const result = await this.requireCloud().getFunctions(id)
    if (!Array.isArray(result.functions)) throw new DriverError('A Tuya não retornou os controles deste aparelho.')
    this.functions.set(id, result.functions)
    return result.functions
  }

  /** Uma listagem por vez: a UI e o tempo real pedem juntos ao abrir o app. */
  listDevices(): Promise<Device[]> {
    this.listing ??= this.list().finally(() => { this.listing = null })
    return this.listing
  }

  private async list(): Promise<Device[]> {
    const startedAt = Date.now()
    // A revisão vale de antes da consulta: o estado já vem nela.
    const revs = new Map([...this.known].map(([id, entry]) => [id, entry.rev]))
    const list = await this.requireCloud().listDevices()
    const devices: Device[] = []
    const seen = new Set<string>()
    for (const info of list) {
      if (!LIGHT_CATEGORIES.has(info.category)) continue
      const device = await this.hydrate(info, revs.get(info.id) ?? 0)
      if (device) { devices.push(device); seen.add(info.id) }
    }
    for (const [id, entry] of this.known) if (!seen.has(id) && entry.at < startedAt) this.known.delete(id)
    return devices
  }

  async getDevice(deviceId: string): Promise<Device> {
    const rev = this.known.get(deviceId)?.rev ?? 0
    const info = await this.requireCloud().getDevice(deviceId)
    if (!LIGHT_CATEGORIES.has(info.category)) throw new DriverError('Este tipo de aparelho Tuya ainda não tem controles no Home Control.')
    const device = await this.hydrate(info, rev)
    if (!device) throw new DriverError('Este aparelho não é uma lâmpada controlável.')
    return device
  }

  /** `rev`: revisão do cache quando a consulta que trouxe `info` começou. */
  private async hydrate(info: TuyaApiDevice, rev: number): Promise<Device | null> {
    const status = info.status ?? await this.requireCloud().getStatus(info.id)
    const functions = await this.getFunctions(info.id)
    const fresh = { ...info, status: undefined }
    const current = this.known.get(info.id)
    // Um relato do MQTT chegou durante a leitura: ele é mais novo que ela.
    if (current && current.rev !== rev) {
      current.info = { ...fresh, online: current.info.online }
      return this.build(current.info, current.status, functions)
    }
    const device = this.build(info, status, functions)
    if (device) this.known.set(info.id, { info: fresh, status, rev, at: Date.now() })
    return device
  }

  private build(info: TuyaApiDevice, status: TuyaStatusItem[], functions: TuyaFunction[]): Device | null {
    if (!isControllableBulb(status, functions)) return null
    const caps = bulbCapabilities(status, functions)
    const modes = caps.color ? bulbModes(status, functions) : []
    const capabilities: Capability[] = [{ kind: 'power' }]
    if (caps.brightness) capabilities.push({ kind: 'brightness', min: 1, max: 100 })
    if (caps.color) capabilities.push({ kind: 'color' })
    if (caps.colorTemperature) capabilities.push({ kind: 'colorTemperature' })
    if (hasCountdown(status, functions)) capabilities.push({ kind: 'timer', actions: ['off', 'on'], maxMinutes: countdownMaxMinutes(functions) })
    if (modes.length > 1) capabilities.push({ kind: 'mode', options: modes })
    return {
      id: info.id, driverId: this.id, name: info.name?.trim() || 'Lâmpada Tuya',
      model: info.product_name, kind: 'light', capabilities,
      state: readState(status, info.online, functions)
    }
  }

  async execute(deviceId: string, command: Command): Promise<void> {
    const cloud = this.requireCloud()
    const functions = await this.getFunctions(deviceId)
    if (!functions.some((item) => item.code === 'switch_led')) throw new DriverError('Este aparelho não é uma lâmpada controlável.')
    switch (command.type) {
      case 'power':
        await cloud.sendCommands(deviceId, [powerCommand(command.value)])
        return
      case 'brightness': {
        const status = await cloud.getStatus(deviceId)
        await cloud.sendCommands(deviceId, [brightnessCommand(status, command.value, functions)])
        return
      }
      case 'color': {
        const status = await cloud.getStatus(deviceId)
        await cloud.sendCommands(deviceId, colorCommands(status, command.value, functions))
        return
      }
      case 'timer': {
        if (!functions.some((item) => item.code === 'countdown_1')) throw new DriverError('Esta lâmpada não tem timer.')
        // O contador inverte a energia: "desligar" so faz sentido acesa, "ligar" so apagada.
        const status = await cloud.getStatus(deviceId)
        const power = status.find((item) => item.code === 'switch_led')?.value === true
        if (command.minutes !== null && (command.action === 'off') !== power) {
          throw new DriverError(power ? 'A lâmpada já está acesa.' : 'A lâmpada já está apagada.')
        }
        await cloud.sendCommands(deviceId, [countdownCommand(command.minutes, functions)])
        return
      }
      case 'colorTemperature': {
        const status = await cloud.getStatus(deviceId)
        await cloud.sendCommands(deviceId, colorTemperatureCommands(status, command.value, functions))
        return
      }
      case 'mode': {
        const status = await cloud.getStatus(deviceId)
        if (!bulbModes(status, functions).includes(command.value)) throw new DriverError('Modo não suportado por esta lâmpada.')
        await cloud.sendCommands(deviceId, [{ code: 'work_mode', value: command.value }])
        return
      }
      default:
        throw new DriverError(`Comando não suportado pela lâmpada: ${command.type}`)
    }
  }

  /** Tempo real pelo MQTT oficial da conexão por QR Code. */
  async watch(listener: RealtimeListener): Promise<RealtimeHandle> {
    const api = this.cloud
    const listHomeIds = api?.listHomeIds?.bind(api)
    const getMqttConfig = api?.getMqttConfig?.bind(api)
    if (!listHomeIds || !getMqttConfig) {
      listener.status('off')
      return { stop: async () => {} }
    }

    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const later = (key: string, delay: number, run: () => void): void => {
      if (timers.has(key)) return
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
    // Aparelho entrou ou saiu: a próxima conexão relista por conta própria.
    let topologyDirty = false

    const link: MqttLink = new MqttLink({
      prepare: async () => {
        if (this.known.size === 0 || topologyDirty) {
          await this.listDevices()
          topologyDirty = false
        }
        const [homes, config] = await Promise.all([listHomeIds(), getMqttConfig()])
        const topics = [
          ...homes.map((home) => config.ownerTopic.replace('{ownerId}', home)),
          ...[...this.known.values()].map(({ info }) => config.deviceTopic.replace('{devId}', info.id) + (info.local ? '/pen' : '/sta'))
        ]
        return {
          url: secureBrokerUrl(config.url, TUYA_BROKER_DOMAINS),
          options: { clientId: config.clientId, username: config.username, password: config.password, protocolVersion: 4, keepalive: 60 },
          topics,
          expiresAt: Date.now() + config.expireTime * 1000
        }
      },
      message: (_topic, payload) => {
        let raw: unknown
        try { raw = JSON.parse(payload.toString('utf8')) } catch { return }
        const message = parseTuyaMessage(raw)
        if (!message) return
        const entry = this.known.get(message.devId)
        if (message.kind === 'changed') {
          listener.event({ type: 'refresh' })
          if (message.topology) {
            topologyDirty = true
            later('topology', TOPOLOGY_RESTART_MS, () => link.restart())
          }
          return
        }
        if (!entry) return
        if (message.kind === 'availability') {
          entry.info = { ...entry.info, online: message.online }
          listener.event({ type: 'availability', deviceId: message.devId, online: message.online })
          return
        }
        const functions = this.functions.get(message.devId) ?? []
        const { updates, unresolved } = resolveReport(message.items, entry.info, functions)
        if (unresolved) reread(message.devId)
        if (updates.length === 0) return
        // A energia mudou e o contador não veio: ele pode ter acabado de zerar. Confirma pela nuvem.
        const countdown = entry.status.find((item) => item.code === 'countdown_1')?.value
        if (updates.some((item) => item.code === 'switch_led') && !updates.some((item) => item.code === 'countdown_1') && typeof countdown === 'number' && countdown > 0) {
          reread(message.devId)
        }
        // Quem relata estado está online.
        entry.status = mergeStatus(entry.status, updates)
        entry.info = { ...entry.info, online: true }
        entry.rev = ++this.revision
        const device = this.build(entry.info, entry.status, functions)
        if (device) listener.event({ type: 'state', device })
      },
      status: (state, error) => listener.status(state, error),
      reconnected: () => listener.event({ type: 'refresh' }),
      isFatal: (cause) => cause instanceof Error && FATAL_CODES.has(String((cause as { code?: unknown }).code)),
      ...(this.connectMqtt ? { connect: this.connectMqtt } : {})
    })
    link.start()
    return {
      stop: async () => {
        for (const timer of timers.values()) clearTimeout(timer)
        timers.clear()
        await link.stop()
      }
    }
  }
}
