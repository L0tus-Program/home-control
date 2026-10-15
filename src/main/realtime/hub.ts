import type { Device, DeviceEvent, DeviceEventBatch, RealtimeStatus } from '../../shared/types'
import type { Driver, RealtimeHandle, RealtimeListener } from '../drivers/types'

/** Espera o proximo estado de um aparelho, para confirmar um comando pelo evento. */
export interface StateWaiter {
  wait(timeoutMs: number): Promise<Device | null>
  cancel(): void
}

export interface HubOutput {
  events(batch: DeviceEventBatch): void
  status(statuses: Record<string, RealtimeStatus>): void
}

/** Rajadas do MQTT (varios campos mudando juntos) viram uma mensagem so para a UI. */
const COALESCE_MS = 100
/** Espera de confirmacao nunca passa disso, mesmo que o comando pendure. */
const WAITER_MAX_MS = 60_000
/** Um canal preso nunca pode travar a troca de configuracao. */
const STEP_TIMEOUT_MS = 5000

function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))])
}

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
  private waiters = new Map<string, Set<(device: Device | null) => void>>()

  constructor(private readonly output: HubOutput, private readonly coalesceMs = COALESCE_MS) {}

  /**
   * Serializado: dois `restart` seguidos nunca deixam dois canais ligados. Uma
   * fabrica e avaliada so na vez dela, e uma falha ao montar os drivers vira
   * "sem tempo real" em vez de erro para quem salvou a configuracao.
   */
  restart(drivers: Driver[] | (() => Driver[])): Promise<void> {
    this.chain = this.chain.then(() => this.swap(typeof drivers === 'function' ? drivers() : drivers)).catch(() => undefined)
    return this.chain
  }

  /** Termina quando o ultimo `restart` pedido terminou. */
  idle(): Promise<void> {
    return this.chain
  }

  /** Ha algum canal ligado ou ligando? */
  isActive(): boolean {
    return this.handles.length > 0
  }

  stop(): Promise<void> {
    return this.restart([])
  }

  getStatuses(): Record<string, RealtimeStatus> {
    return { ...this.statuses }
  }

  /**
   * Registra a espera antes do comando, para nao perder um evento rapido. So
   * conta um estado que `matches` aceita (o valor comandado): evento antigo, do
   * controle remoto ou parcial nao confirma. Sem canal ao vivo, devolve null e o
   * comando confirma por leitura; se o canal cair, a espera termina na hora.
   */
  waitForState(driverId: string, deviceId: string, matches: (device: Device) => boolean): StateWaiter | null {
    if (this.statuses[driverId]?.state !== 'live') return null
    const key = `${driverId}:${deviceId}`
    let received: Device | null = null
    let settle: ((device: Device | null) => void) | null = null
    // Teto de vida: um `execute` pendurado nao deixa a espera registrada para sempre.
    const safety = setTimeout(() => { cancel(); settle?.(null) }, WAITER_MAX_MS)
    const onState = (device: Device | null): void => {
      if (device === null) { cancel(); settle?.(null); return }
      if (!matches(device)) return
      received = device
      settle?.(device)
    }
    let set = this.waiters.get(key)
    if (!set) this.waiters.set(key, (set = new Set()))
    set.add(onState)
    const cancel = (): void => {
      clearTimeout(safety)
      set.delete(onState)
      if (set.size === 0 && this.waiters.get(key) === set) this.waiters.delete(key)
    }
    return {
      wait: (timeoutMs) => new Promise<Device | null>((resolve) => {
        if (received || !set.has(onState)) { cancel(); resolve(received); return }
        const timer = setTimeout(() => { cancel(); resolve(null) }, timeoutMs)
        settle = (device) => { clearTimeout(timer); cancel(); resolve(device) }
      }),
      cancel
    }
  }

  /** Canal do driver caiu ou foi trocado: ninguem espera evento que nao vira. */
  private releaseWaiters(driverId?: string): void {
    for (const [key, set] of [...this.waiters]) {
      if (driverId !== undefined && !key.startsWith(`${driverId}:`)) continue
      for (const waiter of [...set]) waiter(null)
    }
  }

  /** Depois de suspensao o canal pode ter perdido eventos: pede uma releitura. */
  resync(): void {
    for (const [driverId, status] of Object.entries(this.statuses)) {
      if (status.state === 'live') this.enqueue(driverId, { type: 'refresh' })
    }
  }

  private async swap(drivers: Driver[]): Promise<void> {
    const generation = ++this.generation
    this.releaseWaiters()
    const previous = this.handles
    this.handles = []
    this.queue.clear()
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    await Promise.all(previous.map(async (pending) => {
      const handle = await within(pending, STEP_TIMEOUT_MS, null)
      if (!handle) return
      await within(Promise.resolve().then(() => handle.stop()), STEP_TIMEOUT_MS, undefined)
    }))

    this.statuses = {}
    for (const driver of drivers) {
      let configured = false
      try { configured = Boolean(driver.watch) && driver.isConfigured() } catch { configured = false }
      if (!configured) {
        this.statuses[driver.id] = { state: 'off' }
        continue
      }
      this.statuses[driver.id] = { state: 'connecting' }
      const current = (): boolean => generation === this.generation
      const listener: RealtimeListener = {
        event: (event) => { if (current()) this.enqueue(driver.id, event) },
        status: (state, error) => {
          if (!current()) return
          const was = this.statuses[driver.id]?.state
          this.statuses[driver.id] = error ? { state, error } : { state }
          try { this.output.status(this.getStatuses()) } catch { /* idem */ }
          // Entre a ultima leitura e o canal ficar ao vivo, eventos podem ter passado.
          if (state === 'live' && was !== 'live') this.enqueue(driver.id, { type: 'refresh' })
          if (state !== 'live') this.releaseWaiters(driver.id)
        }
      }
      this.handles.push(Promise.resolve().then(() => driver.watch!(listener)).catch((cause) => {
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
      // Quem espera confirmar um comando recebe na hora, sem o agrupamento.
      for (const waiter of [...(this.waiters.get(`${driverId}:${event.device.id}`) ?? [])]) waiter(event.device)
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
      if (events.size === 0) continue
      try { this.output.events({ driverId, events: [...events.values()] }) } catch { /* janela fechando: o proximo lote chega */ }
    }
  }
}
