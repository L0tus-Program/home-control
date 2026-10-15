import { BrowserWindow, powerMonitor } from 'electron'
import { publicDevice } from '../../shared/devices'
import type { Device, DeviceEvent, DeviceEventBatch, RealtimeStatus } from '../../shared/types'
import { currentDrivers, onDriversChanged } from '../drivers/registry'
import { RealtimeHub, type StateWaiter } from './hub'

/** O tempo real vive no processo principal; as janelas so recebem `Device` traduzido. */

let hub: RealtimeHub | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send(channel, payload)
    } catch { /* janela fechando */ }
  }
}

function publicEvent(event: DeviceEvent): DeviceEvent {
  return event.type === 'state' ? { type: 'state', device: publicDevice(event.device) } : event
}

export function startRealtime(): void {
  if (hub) return
  const current = new RealtimeHub({
    events: (batch): void => {
      if (process.env.HOME_CONTROL_REALTIME_DEBUG === '1') console.log('[tempo real]', batch.driverId, batch.events.map((event) => event.type).join(','))
      broadcast('devices:events', { driverId: batch.driverId, events: batch.events.map(publicEvent) } satisfies DeviceEventBatch)
    },
    status: (statuses) => {
      // Diagnostico de desenvolvimento: so estado e mensagem de erro, nunca payload.
      if (process.env.HOME_CONTROL_REALTIME_DEBUG === '1') console.log('[tempo real]', JSON.stringify(statuses))
      broadcast('realtime:status', statuses)
    }
  })
  hub = current
  // Token novo, conta Tuya reconectada ou desconectada: troca o canal junto.
  onDriversChanged(() => void current.restart(currentDrivers))
  powerMonitor.on('resume', () => current.resync())
  void current.restart(currentDrivers)
}

/** Confirmacao de comando pelo evento do aparelho; null sem canal ao vivo. */
export function waitForDeviceState(driverId: string, deviceId: string, matches: (device: Device) => boolean): StateWaiter | null {
  return hub?.waitForState(driverId, deviceId, matches) ?? null
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
