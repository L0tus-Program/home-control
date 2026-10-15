import mqtt, { type IClientOptions, type MqttClient } from 'mqtt'
import type { RealtimeState } from '../../shared/types'
import { RealtimeError } from './broker'

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
  /** `redelivered`: o broker ja tinha entregue (flag DUP do MQTT). */
  message(topic: string, payload: Buffer, redelivered: boolean): void
  status(state: RealtimeState, error?: string): void
  /** Toda conexao depois da primeira pode ter perdido eventos. */
  reconnected(): void
  connect?: (url: string, options: IClientOptions) => MqttClient
  /** Falha de preparo que nao adianta repetir (sessao removida, token invalido). */
  isFatal?: (cause: unknown) => boolean
  /** Prazos; ajustaveis nos testes. */
  timing?: Partial<LinkTiming>
}

interface LinkTiming {
  minBackoffMs: number
  maxBackoffMs: number
  /** So depois de tanto tempo conectado uma conexao conta como estavel e zera a espera. */
  stableMs: number
  subscribeTimeoutMs: number
}

const DEFAULT_TIMING: LinkTiming = { minBackoffMs: 1000, maxBackoffMs: 60_000, stableMs: 60_000, subscribeTimeoutMs: 15_000 }

/** Mensagens maiores que isso nao sao estado de aparelho; descartamos. */
export const MAX_PAYLOAD_BYTES = 64 * 1024
/** Depois de tantas falhas seguidas a UI mostra "Atualização manual", mas seguimos tentando. */
const FAILURES_BEFORE_UNAVAILABLE = 3
/** `setTimeout` acima de ~24,8 dias dispara na hora; renovacao nunca espera mais que isso. */
const MAX_RENEW_MS = 12 * 60 * 60 * 1000

/**
 * Texto para a UI. Erros do proprio app (`DriverError`, `RealtimeError`) ja sao
 * legiveis; os do mqtt.js e do Node (IP, porta, certificado) ficam de fora.
 */
function friendly(cause: unknown): string {
  if (cause instanceof Error && (cause.name === 'DriverError' || cause.name === 'RealtimeError') && cause.message) return cause.message
  return 'Não consegui manter a atualização em tempo real. Tentando de novo.'
}

/**
 * Recusa de SUBACK no mqtt.js 5.16: o `subscribeAsync` rejeita com
 * `ErrorWithSubackPacket`, que traz `packet.granted` com 0x80 (sem `code`).
 */
function isRefusal(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false
  const granted = (cause as { packet?: { granted?: unknown } }).packet?.granted
  if (Array.isArray(granted)) return granted.some((code) => typeof code === 'number' && code >= 128)
  const code = (cause as { code?: unknown }).code
  return typeof code === 'number' && code >= 128
}

/**
 * Uma conexao MQTT que se mantem sozinha: reconecta com espera crescente,
 * renova credenciais antes de vencer e nunca lanca para quem a usa.
 */
export class MqttLink {
  private client: MqttClient | null = null
  private detach: (() => void) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stableTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private failures = 0
  private connectedOnce = false
  private attempt = 0
  private lastError: unknown = undefined
  private reported: RealtimeState | null = null
  private readonly timing: LinkTiming

  constructor(private readonly options: LinkOptions) {
    this.timing = { ...DEFAULT_TIMING, ...options.timing }
  }

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

  /** Nunca ficou ao vivo nesta sessao: falha de credencial e provavel. */
  connectedNever(): boolean {
    return !this.connectedOnce
  }

  private report(state: RealtimeState, error?: string): void {
    // Enquanto tenta de novo, "Atualização manual" nao pisca de volta para "conectando".
    if (state === 'connecting' && this.reported === 'unavailable' && !error) return
    this.reported = state
    try { this.options.status(state, error) } catch { /* quem escuta nao derruba o canal */ }
  }

  private close(): void {
    this.attempt++
    if (this.timer) clearTimeout(this.timer)
    if (this.stableTimer) clearTimeout(this.stableTimer)
    this.timer = null
    this.stableTimer = null
    this.detach?.()
    this.detach = null
    const client = this.client
    this.client = null
    // So os nossos handlers saem; os internos do mqtt.js limpam os proprios timers.
    // Sem listener de erro, um erro tardio do socket derrubaria o processo.
    if (client) {
      client.on('error', () => undefined)
      client.end(true)
    }
  }

  private schedule(delay: number): void {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; void this.open() }, delay)
  }

  private fail(cause: unknown): void {
    if (this.stopped) return
    this.lastError = cause
    this.close()
    if (this.options.isFatal?.(cause)) {
      // Fatal e sempre erro da API do fabricante, com mensagem propria.
      this.report('unavailable', cause instanceof Error && cause.message ? cause.message : friendly(cause))
      return
    }
    this.failures++
    const { minBackoffMs, maxBackoffMs } = this.timing
    const base = Math.min(maxBackoffMs, minBackoffMs * 2 ** (this.failures - 1))
    const delay = Math.round(base / 2 + Math.random() * base / 2)
    this.report(this.failures >= FAILURES_BEFORE_UNAVAILABLE ? 'unavailable' : 'connecting', friendly(cause))
    this.schedule(delay)
  }

  private async open(): Promise<void> {
    if (this.stopped) return
    const attempt = ++this.attempt
    const current = (): boolean => attempt === this.attempt && !this.stopped
    try {
      this.report('connecting')
      const target = await this.options.prepare(this.lastError)
      if (!current()) return
      this.connect(target, current)
    } catch (cause) {
      if (current()) this.fail(cause)
    }
  }

  private connect(target: LinkTarget, current: () => boolean): void {
    const connect = this.options.connect ?? mqtt.connect
    const client = connect(target.url, {
      ...target.options,
      reconnectPeriod: 0,
      connectTimeout: 15_000,
      rejectUnauthorized: true
    })
    this.client = client

    const onMessage = (topic: string, payload: Buffer, packet?: { dup?: boolean }): void => {
      if (!current() || payload.length > MAX_PAYLOAD_BYTES) return
      try { this.options.message(topic, payload, packet?.dup === true) } catch { /* mensagem ruim nao derruba o canal */ }
    }
    const onError = (error: Error): void => { if (current()) this.fail(error) }
    const onClose = (): void => { if (current()) this.fail(new RealtimeError('Conexão de tempo real encerrada.')) }
    const onConnect = (): void => {
      if (current()) void this.subscribe(client, target, current).catch((cause) => { if (current()) this.fail(cause) })
    }
    client.on('message', onMessage)
    client.on('error', onError)
    client.on('close', onClose)
    client.on('connect', onConnect)
    this.detach = () => {
      client.off('message', onMessage)
      client.off('error', onError)
      client.off('close', onClose)
      client.off('connect', onConnect)
    }
  }

  private async subscribe(client: MqttClient, target: LinkTarget, current: () => boolean): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    const expired = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new RealtimeError('Assinatura de tempo real sem resposta.')), this.timing.subscribeTimeoutMs)
    })
    let results: PromiseSettledResult<unknown>[]
    try {
      results = await Promise.race([Promise.allSettled(target.topics.map((topic) => client.subscribeAsync(topic, { qos: 1 }))), expired])
    } finally {
      clearTimeout(timeout)
    }
    if (!current()) return
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    // Um topico recusado (aparelho sem permissao) nao tira o tempo real dos outros.
    const broken = failed.find((result) => !isRefusal(result.reason))
    if (broken) throw broken.reason
    if (target.topics.length > 0 && failed.length === target.topics.length) throw new RealtimeError('O servidor recusou as assinaturas de tempo real.')

    this.lastError = undefined
    this.report('live')
    if (this.connectedOnce) this.options.reconnected()
    this.connectedOnce = true
    // A espera entre tentativas so zera depois de a conexao provar que se mantem.
    this.stableTimer = setTimeout(() => { this.stableTimer = null; this.failures = 0 }, this.timing.stableMs)
    if (target.expiresAt !== undefined) {
      const delay = Math.min(MAX_RENEW_MS, Math.max(this.timing.minBackoffMs, target.expiresAt - Date.now() - 60_000))
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(() => { this.timer = null; this.restart() }, delay)
    }
  }
}
