import type { Capability, Command, Device, DeviceState } from '../../../shared/types'
import { DriverError, type Driver } from '../types'
import { ThinqClient, type ThinqDeviceListItem } from './client'

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

  return {
    modes: writableOptions(jobMode),
    fanKey,
    fanOptions: writableOptions(fan),
    tempResource: resource,
    targets
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
    humidity: numeric(asRecord(raw.airQualitySensor).humidity)
  }
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
  return capabilities
}

export class ThinqDriver implements Driver {
  readonly id = THINQ_DRIVER_ID
  readonly label = 'LG ThinQ'

  /** Perfis quase nunca mudam; buscar a cada refresh so queima cota da API. */
  private readonly layouts = new Map<string, AcLayout>()

  constructor(private readonly client: ThinqClient | null) {}

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
    const items = (await client.listDevices()) ?? []
    return Promise.all(items.map((item) => this.hydrate(item)))
  }

  async getDevice(deviceId: string): Promise<Device> {
    const client = this.requireClient()
    const items = (await client.listDevices()) ?? []
    const item = items.find((entry) => entry.deviceId === deviceId)
    if (!item) throw new DriverError('Aparelho nao encontrado na conta LG.')
    return this.hydrate(item)
  }

  private async hydrate(item: ThinqDeviceListItem): Promise<Device> {
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

    // Por ora so o ar-condicionado tem controles. Os outros aparecem listados.
    if (base.kind !== 'air-conditioner') return base

    try {
      const layout = await this.layoutFor(item.deviceId)
      const state = await this.requireClient().getState(item.deviceId)
      return {
        ...base,
        capabilities: buildCapabilities(layout),
        state: readState(state, layout)
      }
    } catch (cause) {
      // Um aparelho offline nao pode derrubar a lista inteira.
      return { ...base, state: { online: false, power: false } }
    }
  }

  private async layoutFor(deviceId: string): Promise<AcLayout> {
    const cached = this.layouts.get(deviceId)
    if (cached) return cached
    const layout = readLayout(await this.requireClient().getProfile(deviceId))
    this.layouts.set(deviceId, layout)
    return layout
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

      default:
        throw new DriverError(`Comando nao suportado pela LG: ${(command as Command).type}`)
    }
  }
}
