import type { Command, Device } from '../../shared/types'

/**
 * Contrato de uma integracao.
 *
 * Para somar as lampadas Elgin depois, basta implementar isto num
 * `drivers/elgin/` e registrar em `registry.ts`. Nem a UI nem o IPC mudam.
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
