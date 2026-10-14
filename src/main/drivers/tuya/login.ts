import { randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import type { AppSettings, TuyaQrCheck } from '../../../shared/types'
import type { TuyaQrCode, TuyaSharingSession } from '../../../shared/tuya'
import { DriverError } from '../types'
import { assertTuyaSharingEndpoint, TUYA_SHARING_CLIENT_ID } from './sharing'

/** Protocolo público do SDK Tuya Device Sharing (MIT), também usado no Home Assistant. */
const LOGIN_URL = 'https://apigw.iotbing.com/v1.0/m/life/home-assistant/qrcode/tokens'
const QR_LIFETIME = 5 * 60_000
interface LoginResponse {
  success?: boolean
  code?: string | number
  msg?: string
  t?: number
  result?: Record<string, unknown>
}
interface PendingLogin {
  requestId: string
  userCode: string
  qrToken?: string
  expiresAt: number
  abort: AbortController
  checking?: Promise<TuyaQrCheck>
}

export class TuyaLogin {
  private active: PendingLogin | null = null
  constructor(private readonly onConnected: (session: TuyaSharingSession) => AppSettings) {}

  private async request(method: 'GET' | 'POST', url: string, pending: PendingLogin): Promise<LoginResponse> {
    let response: Response
    try {
      response = await fetch(url, { method, signal: AbortSignal.any([pending.abort.signal, AbortSignal.timeout(15_000)]), redirect: 'error' })
    } catch {
      throw new DriverError('Não consegui conectar à Tuya. Confira sua internet e tente novamente.')
    }
    const data = await response.json().catch(() => null) as LoginResponse | null
    if (!response.ok || !data || typeof data.success !== 'boolean') {
      throw new DriverError('A Tuya não respondeu como esperado. Tente novamente em instantes.')
    }
    return data
  }

  async start(input: string): Promise<TuyaQrCode> {
    if (typeof input !== 'string' || !/^[a-zA-Z0-9]{4,64}$/.test(input.trim())) {
      throw new DriverError('Copie o Código de Usuário em Eu → Configurações → Conta e segurança no app Tuya Smart ou Smart Life.')
    }
    this.cancel()
    const pending: PendingLogin = {
      requestId: randomUUID(), userCode: input.trim(), expiresAt: Date.now() + QR_LIFETIME, abort: new AbortController()
    }
    this.active = pending
    try {
      const query = new URLSearchParams({ clientid: TUYA_SHARING_CLIENT_ID, usercode: pending.userCode, schema: 'haauthorize' })
      const data = await this.request('POST', `${LOGIN_URL}?${query}`, pending)
      if (!data.success) throw new DriverError(loginError(data))
      const token = data.result?.qrcode
      if (typeof token !== 'string' || !token || token.length > 4096) throw new DriverError('A Tuya não retornou um QR Code válido. Tente novamente.')
      pending.qrToken = token
      const qrDataUrl = await QRCode.toDataURL(`tuyaSmart--qrLogin?token=${token}`, { errorCorrectionLevel: 'Q', width: 320, margin: 4 })
      if (this.active !== pending) throw new DriverError('A conexão Tuya foi cancelada.')
      return { requestId: pending.requestId, qrDataUrl, expiresAt: pending.expiresAt }
    } catch (cause) {
      if (this.active === pending) this.cancel(pending.requestId)
      throw cause
    }
  }

  async check(requestId: string): Promise<TuyaQrCheck> {
    const pending = this.active
    if (!pending || requestId !== pending.requestId || Date.now() >= pending.expiresAt) {
      if (pending?.requestId === requestId) this.cancel(requestId)
      return { status: 'expired' }
    }
    if (!pending.qrToken) return { status: 'waiting' }
    if (pending.checking) return pending.checking
    pending.checking = this.confirm(pending).finally(() => { pending.checking = undefined })
    return pending.checking
  }

  private async confirm(pending: PendingLogin): Promise<TuyaQrCheck> {
    const query = new URLSearchParams({ clientid: TUYA_SHARING_CLIENT_ID, usercode: pending.userCode })
    const data = await this.request('GET', `${LOGIN_URL}/${encodeURIComponent(pending.qrToken!)}?${query}`, pending)
    // Cancelar, gerar outro QR ou fechar a janela invalida inclusive uma resposta já em voo.
    if (this.active !== pending || Date.now() >= pending.expiresAt) return { status: 'expired' }
    if (!data.success) {
      const state = `${data.code ?? ''} ${data.msg ?? ''}`.toLowerCase()
      if (/denied|reject|cancel|refus/.test(state)) throw new DriverError(loginError(data))
      if (/expir|timeout|timed.?out/.test(state)) {
        this.cancel(pending.requestId)
        return { status: 'expired' }
      }
      if (/not.?scan|not.*(?:scanned|confirmed|authorized)|wait.*(?:scan|confirm|authoriz)|pending/.test(state)) return { status: 'waiting' }
      throw new DriverError(loginError(data))
    }
    const result = data.result
    const text = (key: string): string => {
      const value = result?.[key]
      if (typeof value !== 'string' || !value) throw new DriverError('A autorização Tuya está incompleta. Gere outro QR Code e tente novamente.')
      return value
    }
    const expires = result?.expire_time
    if (typeof expires !== 'number' || !Number.isFinite(expires) || expires <= 0) throw new DriverError('A sessão Tuya não tem validade. Gere outro QR Code.')
    const session: TuyaSharingSession = {
      userCode: pending.userCode,
      endpoint: assertTuyaSharingEndpoint(text('endpoint')),
      terminalId: text('terminal_id'),
      token: { accessToken: text('access_token'), refreshToken: text('refresh_token'), uid: text('uid'), expiresAt: Date.now() + expires * 1000 }
    }
    // Callback síncrono: gravação cifrada e conclusão não podem ser intercaladas com cancelamento.
    const settings = this.onConnected(session)
    this.cancel(pending.requestId)
    return { status: 'connected', settings }
  }

  cancel(requestId?: string): void {
    if (requestId !== undefined && this.active?.requestId !== requestId) return
    this.active?.abort.abort()
    this.active = null
  }
}

function loginError(data: LoginResponse): string {
  if (data.code === 'USERCODE_INCORRECT') return 'Código de Usuário não encontrado. Copie o código da conta que está aberta no app Tuya Smart ou Smart Life.'
  if (/denied|reject|cancel|refus/i.test(`${data.code ?? ''} ${data.msg ?? ''}`)) return 'A autorização foi recusada no celular. Gere outro QR Code para tentar novamente.'
  return 'A Tuya ainda não confirmou a autorização. Confirme no celular e tente verificar novamente, ou gere outro QR Code.'
}
