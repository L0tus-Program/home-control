import type { Device } from './types'

/** Identidade unica de um aparelho na app: ids so sao unicos dentro do driver. */
export function deviceKey(device: Pick<Device, 'driverId' | 'id'>): string {
  return `${device.driverId}:${device.id}`
}
