import { randomUUID } from 'node:crypto'
import { DriverError } from '../types'

/**
 * Cliente da API oficial LG ThinQ Connect.
 *
 * Endpoints, cabecalhos e formato de payload conferidos contra o SDK oficial
 * `thinqconnect` (Apache-2.0) rodando em modo mock, nao deduzidos da documentacao.
 */

/** Chave publica que acompanha o SDK oficial da LG. */
const API_KEY = 'v6GFvkweNo7DK7yD3ylIZ9w52aKBU0eJ7wLXkSR3'

// prettier-ignore
const AIC = new Set([
  'AG','AR','AW','BB','BO','BR','BS','BZ','CA','CL','CO','CR','CU','DM','DO','EC',
  'GD','GT','GY','HN','HT','JM','KN','LC','MX','NI','PA','PE','PR','PY','SR','SV',
  'TT','US','UY','VC','VE'
])

// prettier-ignore
const EIC = new Set([
  'AE','AF','AL','AM','AO','AT','AZ','BA','BE','BF','BG','BH','BJ','BY','CD','CF',
  'CG','CH','CI','CM','CV','CY','CZ','DE','DJ','DK','DZ','EE','EG','ES','ET','FI',
  'FR','GA','GB','GE','GH','GM','GN','GQ','GR','HR','HU','IE','IL','IQ','IR','IS',
  'IT','JO','KE','KG','KW','KZ','LB','LR','LT','LU','LV','LY','MA','MD','ME','MK',
  'ML','MR','MT','MU','MW','NE','NG','NL','NO','OM','PK','PL','PS','PT','QA','RO',
  'RS','RU','RW','SA','SD','SE','SI','SK','SL','SN','SO','ST','SY','TD','TG','TN',
  'TR','TZ','UA','UG','UZ','XK','YE','ZA','ZM'
])

/** As tres regioes particionam os paises suportados; o resto cai em KIC. */
export function regionFromCountry(country: string): string {
  const code = country.toUpperCase()
  if (AIC.has(code)) return 'aic'
  if (EIC.has(code)) return 'eic'
  return 'kic'
}

/** O x-message-id da LG: uuid4 cru em base64url, 22 caracteres. */
function messageId(): string {
  const hex = randomUUID().replace(/-/g, '')
  return Buffer.from(hex, 'hex').toString('base64url')
}

export interface ThinqDeviceListItem {
  deviceId: string
  deviceInfo?: {
    deviceType?: string
    modelName?: string
    alias?: string
    reportable?: boolean
  }
}

export interface ThinqConfig {
  token: string
  country: string
  clientId: string
}

export class ThinqClient {
  constructor(private readonly config: ThinqConfig) {}

  /** O MQTT da LG exige o mesmo client id usado no REST. */
  get clientId(): string {
    return this.config.clientId
  }

  private url(endpoint: string): string {
    return `https://api-${regionFromCountry(this.config.country)}.lgthinq.com/${endpoint}`
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      'x-country': this.config.country.toUpperCase(),
      'x-message-id': messageId(),
      'x-client-id': this.config.clientId,
      'x-api-key': API_KEY,
      'x-service-phase': 'OP',
      ...extra
    }
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    options: { body?: unknown; extraHeaders?: Record<string, string> } = {}
  ): Promise<T> {
    const headers = this.headers(options.extraHeaders)
    if (options.body !== undefined) headers['Content-Type'] = 'application/json'

    let response: Response
    try {
      response = await fetch(this.url(endpoint), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(15_000)
      })
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      throw new DriverError(`Nao consegui falar com a nuvem da LG: ${reason}`)
    }

    const payload = (await response.json().catch(() => null)) as
      | { response?: T; error?: { code?: string; message?: string } }
      | null

    if (!response.ok) {
      const code = payload?.error?.code
      const message = payload?.error?.message ?? `HTTP ${response.status}`
      throw new DriverError(describeError(code, message), code)
    }
    return payload?.response as T
  }

  listDevices(): Promise<ThinqDeviceListItem[]> {
    return this.request<ThinqDeviceListItem[]>('GET', 'devices')
  }

  getProfile(deviceId: string): Promise<Record<string, unknown>> {
    return this.request('GET', `devices/${deviceId}/profile`)
  }

  getState(deviceId: string): Promise<Record<string, unknown>> {
    return this.request('GET', `devices/${deviceId}/state`)
  }

  control(deviceId: string, payload: unknown): Promise<unknown> {
    return this.request('POST', `devices/${deviceId}/control`, {
      body: payload,
      extraHeaders: { 'x-conditional-control': 'true' }
    })
  }

  /** Propriedades de energia que o aparelho informa (ex.: `energyUsage`). */
  getEnergyProfile(deviceId: string): Promise<Record<string, unknown>> {
    return this.request('GET', `devices/energy/${encodeURIComponent(deviceId)}/profile`)
  }

  /** `period` DAILY usa datas AAAAMMDD; MONTHLY, AAAAMM (como o SDK `thinqconnect`). */
  getEnergyUsage(deviceId: string, property: string, period: 'DAILY' | 'MONTHLY', start: string, end: string): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ property, period, startDate: start, endDate: end })
    return this.request('GET', `devices/energy/${encodeURIComponent(deviceId)}/usage?${query}`)
  }

  // ── Tempo real (MQTT) ─────────────────────────────────────────────────────

  /** Registra o x-client-id como cliente MQTT. `allowExist` deixa repetir sem erro. */
  registerClient(): Promise<unknown> {
    return this.request('POST', 'client', { body: MQTT_CLIENT_BODY })
  }

  unregisterClient(): Promise<unknown> {
    return this.request('DELETE', 'client', { body: MQTT_CLIENT_BODY })
  }

  getRoute(): Promise<{ mqttServer?: unknown }> {
    return this.request('GET', 'route')
  }

  /** Troca o CSR por um certificado e pelo topico que este cliente pode assinar. */
  issueCertificate(csr: string): Promise<Record<string, unknown>> {
    return this.request('POST', 'client/certificate', {
      body: { 'service-code': MQTT_SERVICE_CODE, csr }
    })
  }

  /** Eventos de estado do aparelho. A LG expira a assinatura; renovamos antes disso. */
  subscribeEvents(deviceId: string): Promise<unknown> {
    return this.request('POST', `event/${encodeURIComponent(deviceId)}/subscribe`, {
      body: { expire: { unit: 'HOUR', timer: EVENT_SUBSCRIPTION_HOURS } }
    })
  }

  unsubscribeEvents(deviceId: string): Promise<unknown> {
    return this.request('DELETE', `event/${encodeURIComponent(deviceId)}/unsubscribe`)
  }

  /** Avisos do aparelho (DEVICE_PUSH): reservatorio cheio, filtro... */
  subscribePush(deviceId: string): Promise<unknown> {
    return this.request('POST', `push/${encodeURIComponent(deviceId)}/subscribe`)
  }

  /** Aparelhos que entram, saem ou mudam de nome na conta. */
  subscribeDeviceList(): Promise<unknown> {
    return this.request('POST', 'push/devices')
  }

  unsubscribeDeviceList(): Promise<unknown> {
    return this.request('DELETE', 'push/devices')
  }
}

const MQTT_SERVICE_CODE = 'SVC202'
const MQTT_CLIENT_BODY = { type: 'MQTT', 'service-code': MQTT_SERVICE_CODE, 'device-type': '607', allowExist: true }
const EVENT_SUBSCRIPTION_HOURS = 4464

/**
 * Assinatura que ja existia: para nos, sucesso. O SDK documenta 1207; a nuvem
 * real (conta BR, 10/2026) responde 4001 "Already Subscribed Home Push".
 */
export const ALREADY_SUBSCRIBED = new Set(['1207', '4001'])

/** Traduz os codigos de erro mais comuns da LG para algo acionavel. */
function describeError(code: string | undefined, fallback: string): string {
  switch (code) {
    case '1103':
    case '1218':
      return 'Token invalido ou expirado. Gere um novo PAT no portal da LG.'
    case '1302':
    case '1303':
      return 'Token nao encontrado para esta conta. Confira o pais configurado.'
    case '1307':
      return 'Pais nao suportado pela API ThinQ Connect.'
    case '1306':
    case '1309':
      return 'Limite de chamadas da API excedido. Tente de novo em alguns minutos.'
    case '1222':
      return 'O aparelho esta offline.'
    case '1220':
    case '2201':
      return 'Esse recurso nao existe neste modelo.'
    case '2304':
      return 'O aparelho precisa estar ligado para aceitar esse comando.'
    case '2305':
      return 'Esse comando nao vale no modo atual do aparelho.'
    default:
      return code ? `${fallback} (codigo ${code})` : fallback
  }
}
