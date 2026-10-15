import { deviceKey } from '../../../shared/devices'
import type { Device, DeviceEventBatch } from '../../../shared/types'

export interface AppliedEvents {
  /** A mesma lista quando nada mudou, para o React nao redesenhar a toa. */
  devices: Device[]
  /** Aparelhos atualizados por evento, para a protecao contra leituras antigas. */
  touched: string[]
  /** O driver pediu para reler a lista dele. */
  needsRefresh: boolean
  /** Chaves de aparelhos que nao estao na lista; quem chama decide se rele. */
  unknown: string[]
}

function sameDevice(a: Device, b: Device): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Aplica eventos de tempo real sobre a lista atual. Funcao pura, sem React.
 *
 * Aparelho com comando em voo ignora o estado vindo do evento: mensagens
 * intermediarias (energia antes da temperatura) fariam o controle piscar, e a
 * resposta do comando ja traz o estado lido depois dele.
 */
export function applyDeviceEvents(devices: Device[], batch: DeviceEventBatch, pending: ReadonlySet<string>): AppliedEvents {
  let next = devices
  const touched: string[] = []
  const unknown: string[] = []
  let needsRefresh = false

  const replace = (key: string, update: (device: Device) => Device): boolean => {
    const index = next.findIndex((device) => deviceKey(device) === key)
    if (index < 0) return false
    if (next === devices) next = [...devices]
    next[index] = update(next[index])
    return true
  }

  for (const event of batch.events) {
    if (event.type === 'refresh') {
      needsRefresh = true
    } else if (event.type === 'notice') {
      // Aviso nao muda o estado; quem mostra e o useDevices.
      continue
    } else if (event.type === 'state') {
      // Um driver so fala dos proprios aparelhos.
      if (event.device.driverId !== batch.driverId) continue
      const key = deviceKey(event.device)
      if (pending.has(key)) continue
      const current = next.find((device) => deviceKey(device) === key)
      if (!current) {
        unknown.push(key)
        continue
      }
      touched.push(key)
      // Eco ou relato repetido: nada a redesenhar.
      if (!sameDevice(current, event.device)) replace(key, () => event.device)
    } else {
      const key = deviceKey({ driverId: batch.driverId, id: event.deviceId })
      const current = next.find((device) => deviceKey(device) === key)
      if (!current || current.state.online === event.online) continue
      replace(key, (device) => ({ ...device, state: { ...device.state, online: event.online } }))
      touched.push(key)
    }
  }
  return { devices: next, touched, needsRefresh, unknown }
}
