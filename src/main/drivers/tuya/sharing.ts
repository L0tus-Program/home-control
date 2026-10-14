import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { TUYA_REGIONS, type TuyaSharingSession } from '../../../shared/tuya'
import { DriverError } from '../types'
import type { TuyaApiDevice, TuyaCommand, TuyaFunction, TuyaStatusItem } from './cloud'

/** Protocolo documentado pelo tuya-device-sharing-sdk (Tuya Inc., licença MIT).
 * Referência: https://github.com/tuya/tuya-device-sharing-sdk/blob/0.2.15/tuya_sharing/customerapi.py
 * Implementação nativa independente; atribuição completa em THIRD_PARTY_NOTICES.
 */
// Identificador público publicado pela integração oficial; não é uma credencial secreta.
export const TUYA_SHARING_CLIENT_ID = 'HA_3y9q4ak7g4ephrvke'

const OFFICIAL_ENDPOINTS = new Set([
  ...TUYA_REGIONS.map(({ endpoint }) => endpoint),
  'https://apigw.iotbing.com',
  'https://apigw.tuyaus.com',
  'https://apigw-ueaz.tuyaus.com',
  'https://apigw.tuyaeu.com',
  'https://apigw-weaz.tuyaeu.com',
  'https://apigw.tuyacn.com',
  'https://apigw.tuyain.com',
  'https://apigw-sg.iotbing.com'
])

export function assertTuyaSharingEndpoint(endpoint: unknown): string {
  if (!text(endpoint)) throw new DriverError('A Tuya retornou um endereço de conexão inválido.')
  let url: URL
  try { url = new URL(endpoint) } catch { throw new DriverError('A Tuya retornou um endereço de conexão inválido.') }
  if (!OFFICIAL_ENDPOINTS.has(url.origin) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new DriverError('A Tuya retornou um endereço de conexão não reconhecido. Conecte a conta novamente.')
  }
  return url.origin
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }

function copySession(session: TuyaSharingSession): TuyaSharingSession {
  return { ...session, token: { ...session.token } }
}

function encrypt(value: unknown, key: Buffer): string {
  const nonce = Buffer.from(randomBytes(9).toString('base64'), 'ascii')
  const cipher = createCipheriv('aes-128-gcm', key, nonce)
  return Buffer.concat([nonce, cipher.update(JSON.stringify(value), 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64')
}

function decrypt(value: unknown, key: Buffer): unknown {
  if (!text(value) || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new DriverError('Resposta inválida da Tuya.')
  try {
    const bytes = Buffer.from(value, 'base64')
    if (bytes.length < 28 || bytes.toString('base64') !== value) throw new Error('invalid data')
    const cipher = createDecipheriv('aes-128-gcm', key, bytes.subarray(0, 12))
    cipher.setAuthTag(bytes.subarray(-16))
    const plain = Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString('utf8')
    try { return JSON.parse(plain) } catch { return plain }
  } catch {
    throw new DriverError('Não consegui validar a resposta da Tuya. Tente novamente.')
  }
}

function apiError(code: unknown): DriverError {
  const safeCode = typeof code === 'number' || (typeof code === 'string' && /^[\w-]{1,32}$/.test(code)) ? String(code) : undefined
  const message = ['1010', '1011', '1012', '1106'].includes(safeCode ?? '')
    ? 'A autorização Tuya expirou ou foi removida. Conecte a conta novamente pelo QR Code.'
    : 'A Tuya não conseguiu concluir a solicitação. Tente novamente.'
  return new DriverError(safeCode ? `${message} (código ${safeCode})` : message, safeCode)
}

function devicesFrom(value: unknown): TuyaApiDevice[] {
  if (!Array.isArray(value)) throw new DriverError('Lista de aparelhos inválida retornada pela Tuya.')
  return value.map((item) => {
    if (!record(item) || !text(item.id) || typeof item.name !== 'string' || typeof item.category !== 'string' || typeof item.online !== 'boolean') {
      throw new DriverError('A Tuya retornou um aparelho incompleto. Atualize e tente novamente.')
    }
    if (item.status !== undefined && (!Array.isArray(item.status) || item.status.some((status) => !record(status) || !text(status.code) || !Object.hasOwn(status, 'value')))) {
      throw new DriverError('Estado inválido retornado pela Tuya.')
    }
    // Mantém somente os dados usados pelo app; respostas também podem conter chaves locais.
    return {
      id: item.id, name: item.name, category: item.category, online: item.online,
      ...(typeof item.product_name === 'string' ? { product_name: item.product_name } : {}),
      ...(Array.isArray(item.status) ? { status: item.status.map(({ code, value }) => ({ code, value })) } : {})
    }
  })
}

/** Compartilhamento oficial autorizado no aplicativo Tuya Smart / Smart Life. */
export class TuyaSharing {
  private session: TuyaSharingSession
  private readonly endpoint: string
  private refreshing: Promise<void> | null = null

  constructor(session: TuyaSharingSession, private readonly onRefresh: (next: TuyaSharingSession) => void | Promise<void>) {
    this.endpoint = assertTuyaSharingEndpoint(session.endpoint)
    if (!session.token || !text(session.token.accessToken) || !text(session.token.refreshToken) || !text(session.token.uid) || !Number.isFinite(session.token.expiresAt)) {
      throw new DriverError('A sessão Tuya está incompleta. Conecte a conta novamente pelo QR Code.')
    }
    this.session = copySession(session)
  }

  private async raw(method: 'GET' | 'POST', path: string, query?: Record<string, unknown>, body?: Record<string, unknown>): Promise<{ result: unknown; t: unknown }> {
    const session = this.session
    const rid = randomUUID()
    const hash = createHash('md5').update(rid + session.token.refreshToken).digest('hex')
    const key = Buffer.from(createHmac('sha256', rid).update(hash).digest('hex').slice(0, 16), 'ascii')
    const encryptedQuery = query ? encrypt(query, key) : ''
    const encryptedBody = body ? encrypt(body, key) : ''
    const headers: Record<string, string> = {
      'X-appKey': TUYA_SHARING_CLIENT_ID,
      'X-requestId': rid,
      'X-sid': '',
      'X-time': String(Date.now()),
      'X-token': session.token.accessToken
    }
    const signedHeaders = ['X-appKey', 'X-requestId', 'X-sid', 'X-time', 'X-token']
      .filter((name) => headers[name]).map((name) => `${name}=${headers[name]}`).join('||')
    headers['X-sign'] = createHmac('sha256', hash).update(signedHeaders + encryptedQuery + encryptedBody).digest('hex')
    if (body) headers['Content-Type'] = 'application/json'
    const search = encryptedQuery ? `?${new URLSearchParams({ encdata: encryptedQuery })}` : ''
    let response: Response
    try {
      response = await fetch(this.endpoint + path + search, {
        method, headers, body: body ? JSON.stringify({ encdata: encryptedBody }) : undefined,
        signal: AbortSignal.timeout(15_000), redirect: 'error'
      })
    } catch {
      throw new DriverError('Não consegui falar com a Tuya. Confira sua conexão e tente novamente.')
    }
    const envelope: unknown = await response.json().catch(() => null)
    if (!response.ok) throw new DriverError(`A Tuya respondeu com HTTP ${response.status}. Tente novamente.`, String(response.status))
    if (!record(envelope) || typeof envelope.success !== 'boolean') throw new DriverError('Resposta inválida da Tuya.')
    if (!envelope.success) throw apiError(envelope.code)
    // O SDK 0.2.15 admite confirmações sem resultado (inclusive null ou string vazia).
    const result = envelope.result
    return { result: result === undefined || result === null || result === '' || result === false || result === 0 ? result : decrypt(result, key), t: envelope.t }
  }

  private async ensureToken(rejectedToken?: string): Promise<void> {
    if (this.refreshing) return this.refreshing
    if (rejectedToken && rejectedToken !== this.session.token.accessToken) return
    if (!rejectedToken && this.session.token.expiresAt - 60_000 > Date.now()) return
    this.refreshing = (async () => {
      const response = await this.raw('GET', `/v1.0/m/token/${encodeURIComponent(this.session.token.refreshToken)}`)
      const token = response.result
      if (!record(token) || !text(token.accessToken) || !text(token.refreshToken) || !text(token.uid) ||
          typeof token.expireTime !== 'number' || !Number.isFinite(token.expireTime) || token.expireTime <= 0 ||
          typeof response.t !== 'number' || !Number.isFinite(response.t) || response.t <= 0) {
        throw new DriverError('A Tuya não renovou a sessão corretamente. Conecte a conta novamente pelo QR Code.')
      }
      const expiresAt = response.t + token.expireTime * 1000
      if (!Number.isFinite(expiresAt) || expiresAt <= response.t) {
        throw new DriverError('A Tuya retornou um prazo inválido para a sessão. Conecte a conta novamente.')
      }
      const next: TuyaSharingSession = {
        ...this.session,
        token: { accessToken: token.accessToken, refreshToken: token.refreshToken, uid: token.uid, expiresAt }
      }
      await this.onRefresh(copySession(next))
      this.session = copySession(next)
    })().finally(() => { this.refreshing = null })
    return this.refreshing
  }

  private async request(method: 'GET' | 'POST', path: string, query?: Record<string, unknown>, body?: Record<string, unknown>): Promise<unknown> {
    await this.ensureToken()
    const accessToken = this.session.token.accessToken
    try {
      return (await this.raw(method, path, query, body)).result
    } catch (error) {
      // Só repete rejeição explícita de autenticação, nunca falhas de rede ou comandos aceitos.
      if (!(error instanceof DriverError) || !['1010', '1011', '1012'].includes(error.code ?? '')) throw error
      await this.ensureToken(accessToken)
      return (await this.raw(method, path, query, body)).result
    }
  }

  async listDevices(): Promise<TuyaApiDevice[]> {
    const homes = await this.request('GET', '/v1.0/m/life/users/homes')
    if (!Array.isArray(homes)) throw new DriverError('Lista de casas inválida retornada pela Tuya.')
    const devices = new Map<string, TuyaApiDevice>()
    const homeIds = new Set<string>()
    for (const home of homes) {
      if (!record(home) || !(text(home.ownerId) || (typeof home.ownerId === 'number' && Number.isSafeInteger(home.ownerId)))) {
        throw new DriverError('A Tuya retornou uma casa inválida. Tente novamente.')
      }
      const id = String(home.ownerId)
      if (homeIds.has(id)) continue
      homeIds.add(id)
      for (const device of devicesFrom(await this.request('GET', '/v1.0/m/life/ha/home/devices', { homeId: id }))) {
        devices.set(device.id, device)
      }
    }
    return [...devices.values()]
  }

  async getDevice(deviceId: string): Promise<TuyaApiDevice> {
    const devices = devicesFrom(await this.request('GET', '/v1.0/m/life/ha/devices/detail', { devIds: deviceId }))
    const device = devices.find(({ id }) => id === deviceId)
    if (!device) throw new DriverError('Esse aparelho não está mais disponível na sua conta Tuya.')
    return device
  }

  async getStatus(deviceId: string): Promise<TuyaStatusItem[]> {
    return (await this.getDevice(deviceId)).status ?? []
  }

  async getFunctions(deviceId: string): Promise<{ functions: TuyaFunction[] }> {
    const result = await this.request('GET', `/v1.1/m/life/${encodeURIComponent(deviceId)}/specifications`)
    if (!record(result) || !Array.isArray(result.functions)) throw new DriverError('Controles inválidos retornados pela Tuya.')
    return {
      functions: result.functions.map((item) => {
        if (!record(item) || !text(item.code) || !text(item.type) || !(typeof item.values === 'string' || record(item.values))) {
          throw new DriverError('A Tuya retornou um controle incompleto.')
        }
        return { code: item.code, type: item.type, values: typeof item.values === 'string' ? item.values : JSON.stringify(item.values) }
      })
    }
  }

  async sendCommands(deviceId: string, commands: TuyaCommand[]): Promise<void> {
    const result = await this.request('POST', `/v1.1/m/thing/${encodeURIComponent(deviceId)}/commands`, undefined, { commands })
    if (result === false) throw new DriverError('A Tuya não aceitou o comando. Atualize o aparelho e tente novamente.')
  }
}
