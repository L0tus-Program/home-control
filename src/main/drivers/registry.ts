import type { Command, Device, DriverStatus } from '../../shared/types'
import {
  getClientId,
  getCountry,
  getToken,
  getTuyaCredentials,
  getTuyaRegion,
  getTuyaSession,
  setTuyaSession
} from '../store'
import { ThinqClient } from './thinq/client'
import { THINQ_DRIVER_ID, ThinqDriver } from './thinq/driver'
import { TuyaCloud } from './tuya/cloud'
import { TuyaDriver } from './tuya/driver'
import { TuyaSharing } from './tuya/sharing'
import type { Driver } from './types'
import { DriverError } from './types'

/**
 * Monta os drivers a partir da configuracao atual.
 *
 * Cada integracao implementa `Driver`; somar uma nova e uma linha aqui. Nada
 * mais no app precisa saber que ela existe.
 */
function buildDrivers(): Driver[] {
  const token = getToken()
  const thinq = new ThinqDriver(
    token ? new ThinqClient({ token, country: getCountry(), clientId: getClientId() }) : null
  )

  const creds = getTuyaCredentials()
  const session = getTuyaSession()
  let expectedRefresh = session?.token.refreshToken
  const tuya = new TuyaDriver(
    session
      ? new TuyaSharing(session, (next) => {
          const current = getTuyaSession()
          if (current?.terminalId !== session.terminalId || current?.token.refreshToken !== expectedRefresh) {
            throw new DriverError('A conexão Tuya mudou. Atualize a tela para continuar.')
          }
          setTuyaSession(next)
          expectedRefresh = next.token.refreshToken
        })
      : creds
      ? new TuyaCloud({
          accessId: creds.accessId,
          accessSecret: creds.accessSecret,
          region: getTuyaRegion()
        })
      : null
  )

  return [thinq, tuya]
}

let cache: Driver[] | null = null

function drivers(): Driver[] {
  if (!cache) cache = buildDrivers()
  return cache
}

/** Chamar sempre que a configuracao mudar, para os drivers pegarem o token novo. */
export function invalidateDrivers(): void {
  cache = null
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

export async function executeCommand(
  driverId: string,
  deviceId: string,
  command: Command
): Promise<Device> {
  const driver = driverById(driverId)
  await driver.execute(deviceId, command)
  // A nuvem da LG leva um instante para refletir o comando no estado.
  await new Promise((resolve) => setTimeout(resolve, 900))
  return driver.getDevice(deviceId)
}

export { THINQ_DRIVER_ID }
