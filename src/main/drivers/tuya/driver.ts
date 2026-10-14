import type { Capability, Command, Device } from '../../../shared/types'
import { DriverError, type Driver } from '../types'
import { brightnessCommand, bulbCapabilities, bulbModes, colorCommands, isControllableBulb, powerCommand, readState } from './bulb'
import type { TuyaApiDevice, TuyaFunction, TuyaStatusItem, TuyaCommand } from './cloud'

/** Cloud de projeto e compartilhamento QR entregam o mesmo modelo ao driver. */
export interface TuyaApi {
  listDevices(): Promise<TuyaApiDevice[]>
  getDevice(id: string): Promise<TuyaApiDevice>
  getStatus(id: string): Promise<TuyaStatusItem[]>
  getFunctions(id: string): Promise<{ functions: TuyaFunction[] }>
  sendCommands(id: string, commands: TuyaCommand[]): Promise<void>
}

export const TUYA_DRIVER_ID = 'tuya'
const LIGHT_CATEGORIES = new Set(['dj', 'dc', 'dd', 'xdd', 'fwd', 'tgq'])

/** Integração oficial Tuya Cloud, independente de LG ThinQ. */
export class TuyaDriver implements Driver {
  readonly id = TUYA_DRIVER_ID
  readonly label = 'Tuya'
  private functions = new Map<string, TuyaFunction[]>()

  constructor(private readonly cloud: TuyaApi | null) {}
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

  async listDevices(): Promise<Device[]> {
    const list = await this.requireCloud().listDevices()
    const devices: Device[] = []
    for (const info of list) {
      if (!LIGHT_CATEGORIES.has(info.category)) continue
      const device = await this.hydrate(info)
      if (device) devices.push(device)
    }
    return devices
  }

  async getDevice(deviceId: string): Promise<Device> {
    const info = await this.requireCloud().getDevice(deviceId)
    if (!LIGHT_CATEGORIES.has(info.category)) throw new DriverError('Este tipo de aparelho Tuya ainda não tem controles no Home Control.')
    const device = await this.hydrate(info)
    if (!device) throw new DriverError('Este aparelho não é uma lâmpada controlável.')
    return device
  }

  private async hydrate(info: TuyaApiDevice): Promise<Device | null> {
    const status = info.status ?? await this.requireCloud().getStatus(info.id)
    const functions = await this.getFunctions(info.id)
    if (!isControllableBulb(status, functions)) return null
    const caps = bulbCapabilities(status, functions)
    const modes = caps.color ? bulbModes(status, functions) : []
    const capabilities: Capability[] = [{ kind: 'power' }]
    if (caps.brightness) capabilities.push({ kind: 'brightness', min: 1, max: 100 })
    if (caps.color) capabilities.push({ kind: 'color' })
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
}
