import type { Capability, Command, Device } from '../../../shared/types'
import { DriverError, type Driver } from '../types'
import { brightnessDps, colorDps, powerDps, readState } from './bulb'
import { TuyaConnection, type TuyaDeviceConfig } from './protocol'

export const TUYA_DRIVER_ID = 'tuya'

/** Uma lâmpada configurada: credencial + nome amigável. */
export interface TuyaBulbConfig extends TuyaDeviceConfig {
  name: string
}

const CAPABILITIES: Capability[] = [
  { kind: 'power' },
  { kind: 'brightness', min: 1, max: 100 },
  { kind: 'color' }
]

/**
 * Controle local das lâmpadas Tuya/Elgin. Fala direto com cada aparelho na
 * rede (porta 6668), sem nuvem. Só precisa da lista de aparelhos com a
 * localKey de cada um — ver `loadTuyaConfig`.
 */
export class TuyaDriver implements Driver {
  readonly id = TUYA_DRIVER_ID
  readonly label = 'Elgin'

  constructor(private readonly bulbs: TuyaBulbConfig[]) {}

  isConfigured(): boolean {
    return this.bulbs.length > 0
  }

  private configFor(deviceId: string): TuyaBulbConfig {
    const bulb = this.bulbs.find((entry) => entry.id === deviceId)
    if (!bulb) throw new DriverError('Lâmpada não configurada.')
    return bulb
  }

  async listDevices(): Promise<Device[]> {
    return Promise.all(this.bulbs.map((bulb) => this.read(bulb)))
  }

  async getDevice(deviceId: string): Promise<Device> {
    return this.read(this.configFor(deviceId))
  }

  private async read(bulb: TuyaBulbConfig): Promise<Device> {
    const base: Device = {
      id: bulb.id,
      driverId: this.id,
      name: bulb.name,
      kind: 'light',
      capabilities: CAPABILITIES,
      state: { online: false, power: false }
    }
    try {
      const dps = await new TuyaConnection(bulb).query()
      return { ...base, state: readState(dps) }
    } catch {
      // Lâmpada sem energia no bocal ou fora da rede: aparece offline.
      return base
    }
  }

  async execute(deviceId: string, command: Command): Promise<void> {
    const bulb = this.configFor(deviceId)
    const connection = new TuyaConnection(bulb)

    switch (command.type) {
      case 'power':
        // O mapa de DP depende do esquema do aparelho, então lemos uma vez.
        await connection.setDps(powerDps(await connection.query(), command.value))
        return
      case 'brightness':
        await connection.setDps(brightnessDps(await connection.query(), command.value))
        return
      case 'color':
        await connection.setDps(colorDps(await connection.query(), command.value))
        return
      default:
        throw new DriverError(`Comando não suportado pela lâmpada: ${command.type}`)
    }
  }
}
