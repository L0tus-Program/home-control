import { BrowserWindow, powerMonitor } from 'electron'
import type { Device, DeviceEvent, DeviceEventBatch, RealtimeStatus } from '../../shared/types'
import { currentDrivers, onDriversChanged } from '../drivers/registry'
import { RealtimeHub } from './hub'

/** O tempo real vive no processo principal; as janelas so recebem `Device` traduzido. */

let hub: RealtimeHub | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload)
    } catch { /* janela fechando */ }
  }
}

/** So o modelo comum cruza para o renderer, mesmo que um driver anexe mais campos. */
function publicDevice(device: Device): Device {
  const { id, driverId, name, model, kind, capabilities, state } = device
  return { id, driverId, name, ...(model === undefined ? {} : { model }), kind, capabilities, state }
}

function publicEvent(event: DeviceEvent): DeviceEvent {
  return event.type === 'state' ? { type: 'state', device: publicDevice(event.device) } : event
}

export function startRealtime(): void {
  if (hub) return
  const current = new RealtimeHub({
    events: (batch): void => broadcast('devices:events', { driverId: batch.driverId, events: batch.events.map(publicEvent) } satisfies DeviceEventBatch),
    status: (statuses) => broadcast('realtime:status', statuses)
  })
  hub = current
  // Token novo, conta Tuya reconectada ou desconectada: troca o canal junto.
  onDriversChanged(() => void current.restart(currentDrivers))
  powerMonitor.on('resume', () => current.resync())
  void current.restart(currentDrivers)
}

/** Ha canal para fechar antes de sair? Sem canal, o encerramento segue direto. */
export function realtimeActive(): boolean {
  return hub?.isActive() ?? false
}

export function realtimeStatuses(): Record<string, RealtimeStatus> {
  return hub?.getStatuses() ?? {}
}

/** Fecha os canais; nunca segura o encerramento do app por mais que `timeoutMs`. */
export async function stopRealtime(timeoutMs = 2000): Promise<void> {
  const current = hub
  hub = null
  onDriversChanged(null)
  if (!current) return
  await Promise.race([current.stop(), new Promise((resolve) => setTimeout(resolve, timeoutMs))])
}
