/**
 * Mensagens do MQTT da ThinQ Connect (SDK `thinqconnect` e integracao oficial
 * do Home Assistant): JSON com `pushType`, `deviceId` e, no estado, um `report`
 * parcial no mesmo formato do `GET devices/{id}/state`.
 */
export type ThinqMessage =
  | { kind: 'status'; deviceId: string; report: Record<string, unknown> }
  /** Aviso do aparelho (filtro, erro); por ora so registrado. */
  | { kind: 'push'; deviceId: string; code?: string }
  /** Aparelho entrou, saiu ou mudou de nome na conta. */
  | { kind: 'changed'; deviceId: string }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const MAX_RESOURCES = 64

export function parseThinqMessage(raw: unknown): ThinqMessage | null {
  if (!record(raw) || typeof raw.deviceId !== 'string' || !raw.deviceId || raw.deviceId.length > 128) return null
  const deviceId = raw.deviceId
  switch (raw.pushType) {
    case 'DEVICE_STATUS':
      if (!record(raw.report) || Object.keys(raw.report).length === 0 || Object.keys(raw.report).length > MAX_RESOURCES) return null
      return { kind: 'status', deviceId, report: raw.report }
    case 'DEVICE_PUSH':
      return { kind: 'push', deviceId, ...(typeof raw.pushCode === 'string' ? { code: raw.pushCode } : {}) }
    case 'DEVICE_REGISTERED':
    case 'DEVICE_UNREGISTERED':
    case 'DEVICE_ALIAS_CHANGED':
      return { kind: 'changed', deviceId }
    default:
      return null
  }
}

/** Listas por unidade (`temperatureInUnits`) sao fundidas entrada a entrada pela `unit`. */
function mergeList(current: unknown, update: unknown[]): unknown[] {
  if (!Array.isArray(current)) return update
  const next = [...current]
  for (const entry of update) {
    const unit = record(entry) ? entry.unit : undefined
    const index = unit === undefined ? -1 : next.findIndex((item) => record(item) && item.unit === unit)
    if (index >= 0 && record(entry)) next[index] = { ...(next[index] as Record<string, unknown>), ...entry }
    else next.push(entry)
  }
  return next
}

/**
 * Aplica o relato parcial sobre o ultimo estado completo. Cada recurso
 * (`operation`, `airFlow`...) e fundido campo a campo; o que nao veio fica.
 */
export function mergeReport(state: Record<string, unknown>, report: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...state }
  for (const [resource, value] of Object.entries(report)) {
    if (resource === '__proto__' || resource === 'constructor' || resource === 'prototype') continue
    const current = next[resource]
    if (Array.isArray(value)) next[resource] = mergeList(current, value)
    else if (record(value) && record(current)) next[resource] = { ...current, ...value }
    else next[resource] = value
  }
  return next
}
