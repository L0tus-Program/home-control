import type { Device } from './types'

/** So o modelo comum cruza para o renderer, mesmo que um driver anexe mais campos. */
export function publicDevice(device: Device): Device {
  const { id, driverId, name, model, kind, capabilities, state } = device
  return { id, driverId, name, ...(model === undefined ? {} : { model }), kind, capabilities, state }
}

/** Identidade unica de um aparelho na app: ids so sao unicos dentro do driver. */
export function deviceKey(device: Pick<Device, 'driverId' | 'id'>): string {
  return `${device.driverId}:${device.id}`
}
