import type { DeviceEvent, DeviceEventBatch, RealtimeStatus } from '../../shared/types'
import type { Driver, RealtimeHandle, RealtimeListener } from '../drivers/types'

export interface HubOutput {
  events(batch: DeviceEventBatch): void
  status(statuses: Record<string, RealtimeStatus>): void
}

/** Rajadas do MQTT (varios campos mudando juntos) viram uma mensagem so para a UI. */
const COALESCE_MS = 100

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Liga o tempo real de cada driver e entrega os eventos agrupados.
 *
 * Nao conhece MQTT nem fabricante: so chama `Driver.watch`. Trocar a
 * configuracao (`restart`) para o canal anterior antes de ligar o novo, e
 * eventos atrasados do canal antigo sao descartados.
 */
export class RealtimeHub {
  private generation = 0
  private handles: Array<Promise<RealtimeHandle | null>> = []
  private statuses: Record<string, RealtimeStatus> = {}
  /** Por driver, o ultimo evento de cada aparelho, na ordem de chegada. */
  private queue = new Map<string, Map<string, DeviceEvent>>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly output: HubOutput, private readonly coalesceMs = COALESCE_MS) {}

  /** Serializado: dois `restart` seguidos nunca deixam dois canais ligados. */
  restart(drivers: Driver[]): Promise<void> {
    this.chain = this.chain.then(() => this.swap(drivers)).catch(() => undefined)
    return this.chain
  }

  stop(): Promise<void> {
    return this.restart([])
  }

  getStatuses(): Record<string, RealtimeStatus> {
    return { ...this.statuses }
  }

  /** Depois de suspensao o canal pode ter perdido eventos: pede uma releitura. */
  resync(): void {
    for (const [driverId, status] of Object.entries(this.statuses)) {
      if (status.state === 'live') this.enqueue(driverId, { type: 'refresh' })
    }
  }

  private async swap(drivers: Driver[]): Promise<void> {
    const generation = ++this.generation
    const previous = this.handles
    this.handles = []
    this.queue.clear()
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await Promise.all(previous.map(async (pending) => {
      const handle = await pending
      await handle?.stop().catch(() => undefined)
    }))

    this.statuses = {}
    for (const driver of drivers) {
      if (!driver.watch || !driver.isConfigured()) {
        this.statuses[driver.id] = { state: 'off' }
        continue
      }
      this.statuses[driver.id] = { state: 'connecting' }
      const current = (): boolean => generation === this.generation
      const listener: RealtimeListener = {
        event: (event) => { if (current()) this.enqueue(driver.id, event) },
        status: (state, error) => {
          if (!current()) return
          this.statuses[driver.id] = error ? { state, error } : { state }
          this.output.status(this.getStatuses())
        }
      }
      this.handles.push(driver.watch(listener).catch((cause) => {
        listener.status('unavailable', message(cause))
        return null
      }))
    }
    this.output.status(this.getStatuses())
  }

  private enqueue(driverId: string, event: DeviceEvent): void {
    let pending = this.queue.get(driverId)
    if (!pending) this.queue.set(driverId, (pending = new Map()))

    if (event.type === 'state') {
      // O estado completo ja diz se esta online; um aviso anterior fica velho.
      pending.delete(`availability:${event.device.id}`)
      pending.delete(`state:${event.device.id}`)
      pending.set(`state:${event.device.id}`, event)
    } else if (event.type === 'availability') {
      const queued = pending.get(`state:${event.deviceId}`)
      if (queued?.type === 'state') {
        const device = queued.device
        pending.set(`state:${event.deviceId}`, { type: 'state', device: { ...device, state: { ...device.state, online: event.online } } })
      } else {
        pending.set(`availability:${event.deviceId}`, event)
      }
    } else {
      pending.set('refresh', event)
    }

    this.timer ??= setTimeout(() => this.flush(), this.coalesceMs)
  }

  private flush(): void {
    this.timer = null
    const queue = this.queue
    this.queue = new Map()
    for (const [driverId, events] of queue) {
      if (events.size > 0) this.output.events({ driverId, events: [...events.values()] })
    }
  }
}
