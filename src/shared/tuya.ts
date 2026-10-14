/** Datacenters publicados na documentação oficial da Tuya. */
export const TUYA_REGIONS = [
  { value: 'us', label: 'América Ocidental', endpoint: 'https://openapi.tuyaus.com' },
  { value: 'ueaz', label: 'América Oriental', endpoint: 'https://openapi-ueaz.tuyaus.com' },
  { value: 'eu', label: 'Europa Central', endpoint: 'https://openapi.tuyaeu.com' },
  { value: 'weaz', label: 'Europa Ocidental', endpoint: 'https://openapi-weaz.tuyaeu.com' },
  { value: 'cn', label: 'China', endpoint: 'https://openapi.tuyacn.com' },
  { value: 'in', label: 'Índia', endpoint: 'https://openapi.tuyain.com' },
  { value: 'sg', label: 'Singapura', endpoint: 'https://openapi-sg.iotbing.com' }
] as const

export function tuyaEndpoint(region: string): string {
  const match = TUYA_REGIONS.find((item) => item.value === region)
  if (!match) throw new Error('Datacenter Tuya inválido. Selecione o mesmo do projeto no portal.')
  return match.endpoint
}

/** Sessão privada da autorização por QR; nunca atravessa o preload. */
export interface TuyaSharingSession {
  userCode: string
  endpoint: string
  terminalId: string
  token: {
    accessToken: string
    refreshToken: string
    uid: string
    expiresAt: number
  }
}

export interface TuyaQrCode {
  requestId: string
  qrDataUrl: string
  expiresAt: number
}
