import { BrowserWindow, ipcMain, shell } from 'electron'
import type { AppSettings, Command, Device, DriverStatus, Result } from '../shared/types'
import { executeCommand, invalidateDrivers, listAllDevices } from './drivers/registry'
import { getCountry, hasToken, setCountry, setToken } from './store'

/** Toda chamada da UI volta como Result: um erro de nuvem nao vira tela branca. */
async function guard<T>(run: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, data: await run() }
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause)
    return { ok: false, error }
  }
}

function currentSettings(): AppSettings {
  return { thinq: { country: getCountry(), hasToken: hasToken() } }
}

export function registerIpc(): void {
  ipcMain.handle('settings:get', () => guard(currentSettings))

  ipcMain.handle(
    'settings:save-thinq',
    (_event, input: { token?: string; country?: string }): Promise<Result<AppSettings>> =>
      guard(() => {
        if (typeof input.country === 'string' && input.country.trim()) {
          setCountry(input.country)
        }
        // String vazia e um pedido explicito de apagar o token.
        if (typeof input.token === 'string') setToken(input.token)
        invalidateDrivers()
        return currentSettings()
      })
  )

  ipcMain.handle(
    'devices:list',
    (): Promise<Result<{ devices: Device[]; statuses: DriverStatus[] }>> => guard(listAllDevices)
  )

  ipcMain.handle(
    'devices:command',
    (
      _event,
      input: { driverId: string; deviceId: string; command: Command }
    ): Promise<Result<Device>> =>
      guard(() => executeCommand(input.driverId, input.deviceId, input.command))
  )

  ipcMain.handle('shell:open-external', (_event, url: string) =>
    guard(() => {
      // So abrimos https, para um link vindo da UI nunca virar execucao local.
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') throw new Error('Link invalido.')
      return shell.openExternal(parsed.toString())
    })
  )

  ipcMain.on('window:action', (event, action: 'minimize' | 'maximize' | 'close') => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (action === 'minimize') window.minimize()
    if (action === 'close') window.close()
    if (action === 'maximize') {
      window.isMaximized() ? window.unmaximize() : window.maximize()
    }
  })
}
