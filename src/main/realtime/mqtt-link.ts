import mqtt, { type IClientOptions, type MqttClient } from 'mqtt'
import type { RealtimeState } from '../../shared/types'

/** O que cada (re)conexao precisa; buscado de novo a cada tentativa, porque credenciais vencem. */
export interface LinkTarget {
  url: string
  options: IClientOptions
  topics: string[]
  /** Quando as credenciais vencem (ms desde a epoca); reconectamos um minuto antes. */
  expiresAt?: number
}

export interface LinkOptions {
  /** `lastError`: por que a tentativa anterior falhou, se falhou. */
  prepare(lastError?: unknown): Promise<LinkTarget>
  message(topic: string, payload: Buffer): void
  status(state: RealtimeState, error?: string): void
  /** Toda conexao depois da primeira pode ter perdido eventos. */
  reconnected(): void
  connect?: (url: string, options: IClientOptions) => MqttClient
  /** Falha de preparo que nao adianta repetir (sessao removida, token invalido). */
  isFatal?: (cause: unknown) => boolean
  /** Espera entre tentativas; ajustável nos testes. */
  backoff?: { min: number; max: number }
}

/** Mensagens maiores que isso nao sao estado de aparelho; descartamos. */
export const MAX_PAYLOAD_BYTES = 64 * 1024
const MIN_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 60_000
/** Depois de tantas falhas seguidas a UI mostra "Atualização manual", mas seguimos tentando. */
const FAILURES_BEFORE_UNAVAILABLE = 3

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Uma conexao MQTT que se mantem sozinha: reconecta com espera crescente,
 * renova credenciais antes de vencer e nunca lanca para quem a usa.
 */
export class MqttLink {
  private client: MqttClient | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private failures = 0
  private connectedOnce = false
  private attempt = 0
  private lastError: unknown = undefined

  constructor(private readonly options: LinkOptions) {}

  start(): void {
    this.stopped = false
    void this.open()
  }

  /** Reabre com dados novos (aparelho entrou, credencial vai vencer). */
  restart(): void {
    if (this.stopped) return
    this.close()
    void this.open()
  }

  async stop(): Promise<void> {
    this.stopped = true
    const client = this.client
    this.close()
    if (client) await client.endAsync(true).catch(() => undefined)
  }

  private close(): void {
    this.attempt++
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const client = this.client
    this.client = null
    if (client) {
      client.removeAllListeners()
      // Sem listener de erro, um erro tardio do socket derrubaria o processo.
      client.on('error', () => undefined)
      client.end(true)
    }
  }

  private schedule(delay: number): void {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; void this.open() }, delay)
  }

  /** Nunca ficou ao vivo nesta sessao: falha de credencial e provavel. */
  connectedNever(): boolean {
    return !this.connectedOnce
  }

  private fail(cause: unknown): void {
    if (this.stopped) return
    this.lastError = cause
    this.close()
    if (this.options.isFatal?.(cause)) {
      this.options.status('unavailable', message(cause))
      return
    }
    this.failures++
    const { min, max } = this.options.backoff ?? { min: MIN_BACKOFF_MS, max: MAX_BACKOFF_MS }
    const base = Math.min(max, min * 2 ** (this.failures - 1))
    const delay = Math.round(base / 2 + Math.random() * base / 2)
    this.options.status(this.failures >= FAILURES_BEFORE_UNAVAILABLE ? 'unavailable' : 'connecting', message(cause))
    this.schedule(delay)
  }

  private async open(): Promise<void> {
    if (this.stopped) return
    const attempt = ++this.attempt
    this.options.status('connecting')
    let target: LinkTarget
    try {
      target = await this.options.prepare(this.lastError)
    } catch (cause) {
      if (attempt === this.attempt) this.fail(cause)
      return
    }
    if (attempt !== this.attempt || this.stopped) return

    const connect = this.options.connect ?? mqtt.connect
    const client = connect(target.url, {
      ...target.options,
      reconnectPeriod: 0,
      connectTimeout: 15_000,
      rejectUnauthorized: true
    })
    this.client = client
    const current = (): boolean => attempt === this.attempt && !this.stopped

    client.on('message', (topic, payload) => {
      if (!current() || payload.length > MAX_PAYLOAD_BYTES) return
      try { this.options.message(topic, payload) } catch { /* mensagem ruim nao derruba o canal */ }
    })
    client.on('error', (error) => { if (current()) this.fail(error) })
    client.on('close', () => { if (current()) this.fail(new Error('Conexão de tempo real encerrada.')) })
    client.on('connect', () => {
      if (!current()) return
      void Promise.all(target.topics.map((topic) => client.subscribeAsync(topic, { qos: 1 }))).then((grants) => {
        if (!current()) return
        const refused = grants.flat().filter((grant) => grant.qos === 128)
        if (refused.length === target.topics.length && target.topics.length > 0) {
          this.fail(new Error('O servidor recusou as assinaturas de tempo real.'))
          return
        }
        this.failures = 0
        this.lastError = undefined
        this.options.status('live')
        if (this.connectedOnce) this.options.reconnected()
        this.connectedOnce = true
        if (target.expiresAt !== undefined) {
          const delay = Math.max(this.options.backoff?.min ?? MIN_BACKOFF_MS, target.expiresAt - Date.now() - 60_000)
          if (this.timer) clearTimeout(this.timer)
          this.timer = setTimeout(() => { this.timer = null; this.restart() }, delay)
        }
      }, (error) => { if (current()) this.fail(error) })
    })
  }
}
