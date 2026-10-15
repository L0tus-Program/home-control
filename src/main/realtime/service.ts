import { BrowserWindow, powerMonitor } from 'electron'
import type { RealtimeStatus } from '../../shared/types'
import { currentDrivers, onDriversChanged } from '../drivers/registry'
import { RealtimeHub } from './hub'

/** O tempo real vive no processo principal; as janelas so recebem `Device` traduzido. */

let hub: RealtimeHub | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

export function startRealtime(): void {
  if (hub) return
  const current = new RealtimeHub({
    events: (batch) => broadcast('devices:events', batch),
    status: (statuses) => broadcast('realtime:status', statuses)
  })
  hub = current
  // Token novo, conta Tuya reconectada ou desconectada: troca o canal junto.
  onDriversChanged(() => void current.restart(currentDrivers()))
  powerMonitor.on('resume', () => current.resync())
  void current.restart(currentDrivers())
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
