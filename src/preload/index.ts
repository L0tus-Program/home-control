import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, Command, Device, DriverStatus, Result, TuyaQrCheck } from '../shared/types'
import type { TuyaQrCode } from '../shared/tuya'

/**
 * A unica superficie que o renderer enxerga. Sem Node, sem ipcRenderer solto:
 * a UI so consegue chamar exatamente estas funcoes.
 */
const api = {
  getSettings: (): Promise<Result<AppSettings>> => ipcRenderer.invoke('settings:get'),

  saveThinq: (input: { token?: string; country?: string }): Promise<Result<AppSettings>> =>
    ipcRenderer.invoke('settings:save-thinq', input),

  saveTuya: (input: {
    accessId?: string
    accessSecret?: string
    region?: string
  }): Promise<Result<AppSettings>> => ipcRenderer.invoke('settings:save-tuya', input),

  startTuyaLogin: (userCode: string): Promise<Result<TuyaQrCode>> => ipcRenderer.invoke('tuya:login-start', userCode),
  checkTuyaLogin: (requestId: string): Promise<Result<TuyaQrCheck>> => ipcRenderer.invoke('tuya:login-check', requestId),
  cancelTuyaLogin: (requestId: string): Promise<Result<void>> => ipcRenderer.invoke('tuya:login-cancel', requestId),
  disconnectTuya: (): Promise<Result<AppSettings>> => ipcRenderer.invoke('tuya:disconnect'),

  listDevices: (driverId?: string): Promise<Result<{ devices: Device[]; statuses: DriverStatus[] }>> =>
    ipcRenderer.invoke('devices:list', driverId),

  sendCommand: (input: {
    driverId: string
    deviceId: string
    command: Command
  }): Promise<Result<Device>> => ipcRenderer.invoke('devices:command', input),

  openExternal: (url: string): Promise<Result<void>> =>
    ipcRenderer.invoke('shell:open-external', url),

  window: {
    minimize: (): void => ipcRenderer.send('window:action', 'minimize'),
    maximize: (): void => ipcRenderer.send('window:action', 'maximize'),
    close: (): void => ipcRenderer.send('window:action', 'close')
  }
}

contextBridge.exposeInMainWorld('home', api)

export type HomeApi = typeof api
