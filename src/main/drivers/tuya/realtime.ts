import type { TuyaApiDevice, TuyaFunction, TuyaStatusItem } from './cloud'

/**
 * Mensagens do MQTT da conexao por QR Code (tuya-device-sharing-sdk 0.2.15,
 * `manager.py`): JSON puro, `protocol` 4 traz estado e 20 traz avisos da conta.
 */
export type TuyaMessage =
  | { kind: 'status'; devId: string; items: TuyaReportItem[] }
  | { kind: 'availability'; devId: string; online: boolean }
  /** Aparelho entrou, saiu ou mudou de nome: reler a lista. */
  | { kind: 'changed'; devId: string; topology: boolean }

export interface TuyaReportItem {
  code?: string
  dpId?: string
  value: unknown
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128

export function parseTuyaMessage(raw: unknown): TuyaMessage | null {
  if (!record(raw) || !record(raw.data)) return null
  const data = raw.data
  if (raw.protocol === 4) {
    if (!text(data.devId) || !Array.isArray(data.status)) return null
    const items: TuyaReportItem[] = []
    for (const item of data.status.slice(0, 64)) {
      if (!record(item) || !Object.hasOwn(item, 'value')) continue
      if (text(item.code)) items.push({ code: item.code, value: item.value })
      else if ((typeof item.dpId === 'number' && Number.isSafeInteger(item.dpId)) || (text(item.dpId) && /^\d+$/.test(item.dpId))) {
        items.push({ dpId: String(item.dpId), value: item.value })
      }
    }
    return items.length ? { kind: 'status', devId: data.devId, items } : null
  }
  if (raw.protocol === 20) {
    const devId = record(data.bizData) ? data.bizData.devId : undefined
    if (!text(devId)) return null
    switch (data.bizCode) {
      case 'online': return { kind: 'availability', devId, online: true }
      case 'offline': return { kind: 'availability', devId, online: false }
      case 'nameUpdate': return { kind: 'changed', devId, topology: false }
      case 'bindUser':
      case 'delete': return { kind: 'changed', devId, topology: true }
      default: return null
    }
  }
  return null
}

/** Codigos que o app desenha. Relatos de outros (cena, musica, timer) nao pedem releitura. */
const RELEVANT = /^(switch_led|bright_value(_v2)?|colour_data(_v2)?|work_mode|temp_value(_v2)?|countdown_1)$/

function matchesType(type: string | undefined, value: unknown): boolean {
  switch (type) {
    case 'Boolean': return typeof value === 'boolean'
    case 'Integer': return typeof value === 'number' && Number.isFinite(value)
    case 'Enum':
    case 'String': return typeof value === 'string'
    case 'Json':
      if (record(value)) return true
      if (typeof value !== 'string') return false
      try { return record(JSON.parse(value)) } catch { return false }
    default: return value !== undefined
  }
}

/**
 * Traduz o relato para codigos. Aparelhos com controle local mandam `dpId`;
 * so aceitamos a traducao quando o valor ja vem no formato do codigo. O resto
 * (conversao desconhecida, cor em hexadecimal) pede uma releitura pela nuvem.
 */
export function resolveReport(items: TuyaReportItem[], device: TuyaApiDevice, functions: TuyaFunction[]): { updates: TuyaStatusItem[]; unresolved: boolean } {
  const updates: TuyaStatusItem[] = []
  let unresolved = false
  for (const item of items) {
    let code = item.code
    let converted = false
    if (!code && item.dpId !== undefined) {
      const dp = device.local?.dps[item.dpId]
      // dpId sem traducao: nao sabemos o que e, entao nao vale uma leitura pela nuvem.
      if (!dp) continue
      code = dp.code
      converted = dp.convert !== undefined && dp.convert !== 'default'
    }
    if (!code) continue
    const declared = functions.find((fn) => fn.code === code)?.type
    if (converted || !matchesType(declared, item.value)) {
      if (RELEVANT.test(code)) unresolved = true
      continue
    }
    updates.push({ code, value: item.value })
  }
  return { updates, unresolved }
}

export function mergeStatus(status: TuyaStatusItem[], updates: TuyaStatusItem[]): TuyaStatusItem[] {
  const next = new Map(status.map((item) => [item.code, item.value]))
  for (const item of updates) next.set(item.code, item.value)
  return [...next].map(([code, value]) => ({ code, value }))
}
