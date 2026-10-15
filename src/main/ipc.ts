import { BrowserWindow, ipcMain, shell } from 'electron'
import type { HomeLayout } from '../shared/home'
import type { AppSettings, Command, Device, DriverStatus, EnergyReport, RealtimeStatus, Result } from '../shared/types'
import { executeCommand, getEnergy, invalidateDrivers, listAllDevices, thinqClientFromStore } from './drivers/registry'
import { loadHomeLayout, placeDevicesInBaseRoom, saveHomeLayout } from './home-layout-store'
import { realtimeSettled, realtimeStatuses, waitForDeviceState } from './realtime/service'
import { publicDevice } from '../shared/devices'
import { TuyaCloud } from './drivers/tuya/cloud'
import { TuyaLogin } from './drivers/tuya/login'
import { tuyaEndpoint } from '../shared/tuya'
import {
  getCountry,
  getTuyaRegion,
  getTuyaCredentials,
  hasToken,
  hasTuyaCredentials,
  getTuyaSession,
  hasTuyaConnection,
  setTuyaSession,
  setCountry,
  setToken,
  saveTuyaConfiguration
} from './store'

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
  const session = getTuyaSession()
  return {
    thinq: { country: getCountry(), hasToken: hasToken() },
    tuya: {
      region: getTuyaRegion(), hasCredentials: hasTuyaConnection(),
      connection: session ? 'qr' : hasTuyaCredentials() ? 'cloud' : null,
      ...(session ? { userCode: session.userCode } : {})
    }
  }
}

export function registerIpc(): void {
  const login = new TuyaLogin((session) => {
    setTuyaSession(session)
    invalidateDrivers()
    return currentSettings()
  })
  ipcMain.handle('tuya:login-start', (_event, userCode: string) => guard(() => login.start(userCode)))
  ipcMain.handle('tuya:login-check', (_event, requestId: string) => guard(() => login.check(requestId)))
  ipcMain.handle('tuya:login-cancel', (_event, requestId: string) => guard(() => login.cancel(requestId)))
  ipcMain.handle('tuya:disconnect', () => guard(() => {
    login.cancel()
    setTuyaSession(null)
    invalidateDrivers()
    return currentSettings()
  }))
  ipcMain.handle('settings:get', () => guard(currentSettings))

  ipcMain.handle(
    'settings:save-thinq',
    (_event, input: { token?: string; country?: string }): Promise<Result<AppSettings>> =>
      guard(async () => {
        // Cliente capturado antes: depois de apagar o token nao ha como desfazer o registro.
        const leaving = input.token === '' ? thinqClientFromStore() : null
        if (typeof input.country === 'string' && input.country.trim()) {
          setCountry(input.country)
        }
        // String vazia e um pedido explicito de apagar o token.
        if (typeof input.token === 'string') setToken(input.token)
        invalidateDrivers()
        if (leaving) {
          // Cortesia com a LG, so depois de o tempo real antigo parar de reconectar.
          await realtimeSettled()
          let timer: ReturnType<typeof setTimeout> | undefined
          await Promise.race([leaving.unregisterClient().catch(() => undefined), new Promise((resolve) => { timer = setTimeout(resolve, 3000) })])
          clearTimeout(timer)
        }
        return currentSettings()
      })
  )

  ipcMain.handle(
    'settings:save-tuya',
    (
      _event,
      input: { accessId?: string; accessSecret?: string; region?: string }
    ): Promise<Result<AppSettings>> =>
      guard(async () => {
        if (!input || typeof input !== 'object') throw new Error('Configuração Tuya inválida.')
        const region = input.region === undefined ? getTuyaRegion() : input.region
        tuyaEndpoint(region)
        let creds = getTuyaCredentials()
        if (input.accessId !== undefined || input.accessSecret !== undefined) {
          if (typeof input.accessId !== 'string' || typeof input.accessSecret !== 'string') {
            throw new Error('Preencha o Access ID e o Access Secret juntos.')
          }
          const accessId = input.accessId.trim()
          const accessSecret = input.accessSecret.trim()
          if (Boolean(accessId) !== Boolean(accessSecret)) throw new Error('Preencha o Access ID e o Access Secret juntos.')
          creds = accessId ? { accessId, accessSecret } : null
        } else if (!creds) {
          throw new Error('Preencha o Access ID e o Access Secret do projeto Tuya.')
        }
        if (creds) {
          // Testa autenticação e permissão de descoberta antes de substituir a conexão salva.
          await new TuyaCloud({ ...creds, region }).listDevices()
        }
        saveTuyaConfiguration(creds, region)
        invalidateDrivers()
        return currentSettings()
      })
  )

  ipcMain.handle(
    'devices:list',
    (_event, driverId?: string): Promise<Result<{ devices: Device[]; statuses: DriverStatus[] }>> =>
      guard(() => listAllDevices(driverId))
  )

  ipcMain.handle(
    'devices:command',
    (
      _event,
      input: { driverId: string; deviceId: string; command: Command }
    ): Promise<Result<Device>> =>
      guard(async () => publicDevice(await executeCommand(input.driverId, input.deviceId, input.command, waitForDeviceState)))
  )

  ipcMain.handle(
    'devices:energy',
    (_event, input: { driverId?: unknown; deviceId?: unknown }): Promise<Result<EnergyReport>> =>
      guard(() => {
        if (typeof input?.driverId !== 'string' || typeof input?.deviceId !== 'string') throw new Error('Aparelho invalido.')
        return getEnergy(input.driverId, input.deviceId)
      })
  )

  ipcMain.handle('realtime:status', (): Promise<Result<Record<string, RealtimeStatus>>> => guard(realtimeStatuses))

  // O layout chega do renderer como dado nao confiavel; o store valida tudo.
  ipcMain.handle('home-layout:get', (): Promise<Result<HomeLayout>> => guard(loadHomeLayout))
  ipcMain.handle(
    'home-layout:save',
    (_event, input: { layout?: unknown; expectedRevision?: unknown }): Promise<Result<HomeLayout>> =>
      guard(() => saveHomeLayout(input?.layout, input?.expectedRevision))
  )
  ipcMain.handle(
    'home-layout:place-devices',
    (_event, devices: unknown): Promise<Result<HomeLayout>> => guard(() => placeDevicesInBaseRoom(devices))
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
