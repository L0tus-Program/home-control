import type { Command, Device, DeviceEvent, EnergyReport, RealtimeState } from '../../shared/types'

/**
 * Contrato de uma integracao.
 *
 * Cada provedor implementa este contrato e se registra em `registry.ts`.
 */
export interface Driver {
  readonly id: string
  readonly label: string

  /** Tem credencial suficiente para tentar falar com a nuvem? */
  isConfigured(): boolean

  /** Lista os aparelhos ja com o estado atual preenchido. */
  listDevices(): Promise<Device[]>

  /** Le o estado de um aparelho so. */
  getDevice(deviceId: string): Promise<Device>

  /** Aplica um comando. Deve lancar erro com mensagem legivel em falha. */
  execute(deviceId: string, command: Command): Promise<void>

  /**
   * Liga o canal de tempo real. Ausente = integracao sem tempo real; o app
   * segue atualizando por leitura. Nunca deve lancar por falha de conexao:
   * reporta pelo `status` e tenta de novo sozinho.
   */
  watch?(listener: RealtimeListener): Promise<RealtimeHandle>

  /** Consumo de energia, para aparelhos com a capability `energy`. */
  getEnergy?(deviceId: string): Promise<EnergyReport>
}

export interface RealtimeListener {
  event(event: DeviceEvent): void
  status(state: RealtimeState, error?: string): void
}

export interface RealtimeHandle {
  stop(): Promise<void>
}

export class DriverError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message)
    this.name = 'DriverError'
  }
}
