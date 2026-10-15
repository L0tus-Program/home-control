import type { Command, Device, DriverStatus } from '../../shared/types'
import {
  getClientId,
  getCountry,
  getThinqMqttCredentials,
  getToken,
  getTuyaCredentials,
  getTuyaRegion,
  getTuyaSession,
  setThinqMqttCredentials,
  setTuyaSession
} from '../store'
import { ThinqClient } from './thinq/client'
import { THINQ_DRIVER_ID, ThinqDriver } from './thinq/driver'
import { TuyaCloud } from './tuya/cloud'
import { TuyaDriver } from './tuya/driver'
import { TuyaSharing } from './tuya/sharing'
import type { Driver } from './types'
import { DriverError } from './types'

export function thinqClientFromStore(): ThinqClient | null {
  const token = getToken()
  return token ? new ThinqClient({ token, country: getCountry(), clientId: getClientId() }) : null
}

/** A sessão QR renova o refresh token; cada renovação precisa voltar ao cofre. */
export function tuyaSharingFromStore(): TuyaSharing | null {
  const session = getTuyaSession()
  if (!session) return null
  let expectedRefresh = session.token.refreshToken
  return new TuyaSharing(session, (next) => {
    const current = getTuyaSession()
    if (current?.terminalId !== session.terminalId || current?.token.refreshToken !== expectedRefresh) {
      throw new DriverError('A conexão Tuya mudou. Atualize a tela para continuar.')
    }
    setTuyaSession(next)
    expectedRefresh = next.token.refreshToken
  })
}

/**
 * Monta os drivers a partir da configuracao atual.
 *
 * Cada integracao implementa `Driver`; somar uma nova e uma linha aqui. Nada
 * mais no app precisa saber que ela existe.
 */
function buildDrivers(): Driver[] {
  const thinq = new ThinqDriver(thinqClientFromStore(), {
    loadCredentials: getThinqMqttCredentials,
    saveCredentials: setThinqMqttCredentials
  })

  const creds = getTuyaCredentials()
  const tuya = new TuyaDriver(
    tuyaSharingFromStore() ??
      (creds
        ? new TuyaCloud({
            accessId: creds.accessId,
            accessSecret: creds.accessSecret,
            region: getTuyaRegion()
          })
        : null)
  )

  return [thinq, tuya]
}

let cache: Driver[] | null = null

function drivers(): Driver[] {
  if (!cache) cache = buildDrivers()
  return cache
}

let changed: (() => void) | null = null

/** Os drivers em uso agora; recriados depois de `invalidateDrivers`. */
export function currentDrivers(): Driver[] {
  return drivers()
}

/** Quem precisa acompanhar a troca de drivers (o tempo real). */
export function onDriversChanged(listener: (() => void) | null): void {
  changed = listener
}

/** Chamar sempre que a configuracao mudar, para os drivers pegarem o token novo. */
export function invalidateDrivers(): void {
  cache = null
  changed?.()
}

export function driverById(id: string): Driver {
  const driver = drivers().find((entry) => entry.id === id)
  if (!driver) throw new DriverError(`Integracao desconhecida: ${id}`)
  return driver
}

export async function listAllDevices(onlyDriverId?: string): Promise<{ devices: Device[]; statuses: DriverStatus[] }> {
  if (onlyDriverId !== undefined) driverById(onlyDriverId)
  const devices: Device[] = []
  const statuses: DriverStatus[] = []

  // Em serie de proposito: a LG limita chamadas por minuto.
  for (const driver of drivers()) {
    const status: DriverStatus = {
      id: driver.id,
      label: driver.label,
      configured: driver.isConfigured()
    }
    if (driver.isConfigured() && (onlyDriverId === undefined || driver.id === onlyDriverId)) {
      try {
        devices.push(...(await driver.listDevices()))
      } catch (cause) {
        status.error = cause instanceof Error ? cause.message : String(cause)
      }
    }
    statuses.push(status)
  }
  return { devices, statuses }
}

/**
 * Com tempo real, quanto esperar o evento que confirma o comando antes de ler.
 * Pouco acima dos 900 ms do caminho sem tempo real: comando que nao muda nada
 * (ligar o que ja esta ligado) nao gera evento e nao pode travar a tela.
 */
const EVENT_CONFIRM_MS = 1500

export interface CommandWaiter {
  wait(timeoutMs: number): Promise<Device | null>
  cancel(): void
}

const near = (a: number | undefined, b: number, tolerance: number): boolean => a !== undefined && Math.abs(a - b) <= tolerance

/** O estado que confirma o comando: o valor pedido, com folga de arredondamento. */
export function confirmsCommand(command: Command): (device: Device) => boolean {
  switch (command.type) {
    case 'power': return (device) => device.state.power === command.value
    case 'temperature': return (device) => near(device.state.temperature, command.value, 0.5)
    case 'mode': return (device) => device.state.mode === command.value
    case 'fan': return (device) => device.state.fan === command.value
    case 'brightness': return (device) => near(device.state.brightness, command.value, 1)
    case 'color': return (device) => near(device.state.color?.hue, command.value.hue, 2) && near(device.state.color?.saturation, command.value.saturation, 2)
    case 'colorTemperature': return (device) => near(device.state.colorTemperature, command.value, 1)
  }
}

export async function executeCommand(
  driverId: string,
  deviceId: string,
  command: Command,
  waitForState?: (driverId: string, deviceId: string, matches: (device: Device) => boolean) => CommandWaiter | null
): Promise<Device> {
  const driver = driverById(driverId)
  // A espera e registrada antes do envio: o evento pode chegar antes da resposta.
  const waiter = waitForState?.(driverId, deviceId, confirmsCommand(command)) ?? null
  try {
    await driver.execute(deviceId, command)
  } catch (cause) {
    waiter?.cancel()
    throw cause
  }
  if (waiter) {
    const confirmed = await waiter.wait(EVENT_CONFIRM_MS)
    if (confirmed) return confirmed
  } else {
    // Sem tempo real: a nuvem da LG leva um instante para refletir o comando no estado.
    await new Promise((resolve) => setTimeout(resolve, 900))
  }
  return driver.getDevice(deviceId)
}

export { THINQ_DRIVER_ID }
