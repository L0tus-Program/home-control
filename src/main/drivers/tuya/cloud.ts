import { createHash, createHmac } from 'node:crypto'
import { tuyaEndpoint } from '../../../shared/tuya'
import { DriverError } from '../types'

export interface TuyaCloudConfig {
  accessId: string
  accessSecret: string
  region: string
}

interface TokenState {
  accessToken: string
  expiresAt: number
}

interface DevicePage {
  devices: TuyaApiDevice[]
  has_more?: boolean
  last_row_key?: string
}

/** OpenAPI oficial: assinatura inclui método, hash do corpo e URL com query ordenada. */
export class TuyaCloud {
  private token: TokenState | null = null
  private tokenRequest: Promise<void> | null = null
  private readonly base: string

  constructor(private readonly config: TuyaCloudConfig) {
    this.base = tuyaEndpoint(config.region)
  }

  private buildHeaders(method: string, path: string, body: string | undefined, token: string): Record<string, string> {
    const t = Date.now().toString()
    const contentHash = createHash('sha256').update(body ?? '').digest('hex')
    const stringToSign = `${method}\n${contentHash}\n\n${path}`
    const sign = createHmac('sha256', this.config.accessSecret)
      .update(`${this.config.accessId}${token}${t}${stringToSign}`)
      .digest('hex').toUpperCase()
    return {
      client_id: this.config.accessId,
      sign,
      sign_method: 'HMAC-SHA256',
      t,
      ...(token ? { access_token: token } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
    }
  }

  private async raw<T>(method: 'GET' | 'POST', path: string, token = '', body?: unknown): Promise<T> {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    let response: Response
    try {
      response = await fetch(`${this.base}${path}`, {
        method,
        headers: this.buildHeaders(method, path, payload, token),
        body: payload,
        signal: AbortSignal.timeout(15_000)
      })
    } catch {
      throw new DriverError('Não consegui falar com a Tuya. Confira sua conexão e tente novamente.')
    }
    const json = await response.json().catch(() => null) as
      | { success?: boolean; result?: T; msg?: string; code?: number | string }
      | null
    if (!response.ok) {
      throw new DriverError(describeError(json?.code, `A Tuya respondeu com HTTP ${response.status}. Tente novamente.`), String(json?.code ?? response.status))
    }
    if (!json || typeof json !== 'object' || typeof json.success !== 'boolean') {
      throw new DriverError('Resposta inválida da Tuya Cloud.')
    }
    if (!json.success) {
      throw new DriverError(describeError(json.code, json.msg ?? 'Falha na Tuya Cloud.'), String(json.code ?? ''))
    }
    if (json.result === undefined || json.result === null) throw new DriverError('Resposta incompleta da Tuya Cloud.')
    return json.result
  }

  private async ensureToken(): Promise<void> {
    if (this.token && Date.now() < this.token.expiresAt) return
    if (!this.tokenRequest) {
      this.tokenRequest = (async () => {
        const result = await this.raw<{ access_token: string; expire_time: number }>('GET', '/v1.0/token?grant_type=1')
        if (!result.access_token || !Number.isFinite(result.expire_time) || result.expire_time <= 0) {
          throw new DriverError('A Tuya não retornou um token válido.')
        }
        const lifetime = result.expire_time * 1000
        this.token = {
          accessToken: result.access_token,
          expiresAt: Date.now() + lifetime - Math.min(300_000, lifetime * 0.1)
        }
      })().finally(() => { this.tokenRequest = null })
    }
    await this.tokenRequest
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    await this.ensureToken()
    const token = this.token!.accessToken
    try {
      return await this.raw<T>(method, path, token, body)
    } catch (cause) {
      // Só repete uma rejeição explícita de autenticação. Comando aceito nunca é reenviado.
      if (!(cause instanceof DriverError) || !['1010', '1011', '1012'].includes(cause.code ?? '')) throw cause
      if (this.token?.accessToken === token) this.token = null
      await this.ensureToken()
      return this.raw<T>(method, path, this.token!.accessToken, body)
    }
  }

  async verify(): Promise<void> {
    await this.ensureToken()
  }

  /** Todas as contas vinculadas ao projeto, sem pedir UID ou ID de cada lâmpada. */
  async listDevices(): Promise<TuyaApiDevice[]> {
    const devices = new Map<string, TuyaApiDevice>()
    const cursors = new Set<string>()
    let cursor: string | undefined
    do {
      const query = new URLSearchParams({ size: '20', ...(cursor ? { last_row_key: cursor } : {}) })
      query.sort()
      const page = await this.request<DevicePage>('GET', `/v1.0/iot-01/associated-users/devices?${query}`)
      if (!page || !Array.isArray(page.devices)) throw new DriverError('Lista de aparelhos inválida retornada pela Tuya.')
      for (const device of page.devices) devices.set(device.id, device)
      if (!page.has_more) break
      cursor = page.last_row_key
      if (!cursor || cursors.has(cursor)) throw new DriverError('A Tuya não conseguiu concluir a lista de aparelhos. Tente novamente.')
      cursors.add(cursor)
    } while (true)
    return [...devices.values()]
  }

  getDevice(deviceId: string): Promise<TuyaApiDevice> {
    return this.request('GET', `/v1.0/devices/${encodeURIComponent(deviceId)}`)
  }

  getStatus(deviceId: string): Promise<TuyaStatusItem[]> {
    return this.request('GET', `/v1.0/devices/${encodeURIComponent(deviceId)}/status`)
  }

  getFunctions(deviceId: string): Promise<{ functions: TuyaFunction[] }> {
    return this.request('GET', `/v1.0/devices/${encodeURIComponent(deviceId)}/functions`)
  }

  async sendCommands(deviceId: string, commands: TuyaCommand[]): Promise<void> {
    const accepted = await this.request<boolean>('POST', `/v1.0/devices/${encodeURIComponent(deviceId)}/commands`, { commands })
    if (accepted !== true) throw new DriverError('A Tuya não aceitou o comando. Atualize o aparelho e tente novamente.')
  }
}

export interface TuyaApiDevice {
  id: string
  name: string
  category: string
  product_name?: string
  online: boolean
  status?: TuyaStatusItem[]
}

export interface TuyaStatusItem { code: string; value: unknown }
export interface TuyaFunction { code: string; type: string; values: string }
export interface TuyaCommand { code: string; value: unknown }

function describeError(code: number | string | undefined, fallback: string): string {
  switch (String(code)) {
    case '1001':
    case '1004':
    case '1005':
      return 'Confira o Access ID, o Access Secret e o datacenter do projeto Tuya.'
    case '1106':
      return 'Sem permissão na Tuya. Vincule a conta do app ao projeto e autorize leitura e controle dos aparelhos.'
    case '1010':
    case '1011':
    case '1012':
      return 'A sessão Tuya expirou. Tente novamente.'
    case '1013':
      return 'Confira a data e a hora do computador para conectar à Tuya.'
    case '2406':
      return 'Ative e autorize IoT Core e Smart Home Basic Service no projeto Tuya; confira se o plano está ativo.'
    case '28841002':
      return 'O plano IoT Core do projeto Tuya expirou. Renove o serviço no portal.'
    default:
      return code ? `${fallback} (código ${code})` : fallback
  }
}
