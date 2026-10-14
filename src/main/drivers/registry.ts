import type { Command, Device, DriverStatus } from '../../shared/types'
import { getClientId, getCountry, getToken } from '../store'
import { ThinqClient } from './thinq/client'
import { THINQ_DRIVER_ID, ThinqDriver } from './thinq/driver'
import type { Driver } from './types'
import { DriverError } from './types'

/**
 * Monta os drivers a partir da configuracao atual.
 *
 * Para somar a Elgin: crie `drivers/elgin/driver.ts` implementando `Driver` e
 * adicione uma linha aqui. Nada mais no app precisa saber que ela existe.
 */
function buildDrivers(): Driver[] {
  const token = getToken()
  const thinq = new ThinqDriver(
    token ? new ThinqClient({ token, country: getCountry(), clientId: getClientId() }) : null
  )
  return [thinq]
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

export async function listAllDevices(): Promise<{ devices: Device[]; statuses: DriverStatus[] }> {
  const devices: Device[] = []
  const statuses: DriverStatus[] = []

  // Em serie de proposito: a LG limita chamadas por minuto.
  for (const driver of drivers()) {
    const status: DriverStatus = {
      id: driver.id,
      label: driver.label,
      configured: driver.isConfigured()
    }
    if (driver.isConfigured()) {
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
