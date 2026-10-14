import { useCallback, useEffect, useRef, useState } from 'react'
import type { Command, Device, DriverStatus } from '../../../shared/types'

/** Enquanto a nuvem confirma, a UI ja mostra o valor novo. */
function applyOptimistic(device: Device, command: Command): Device {
  const state = { ...device.state }
  switch (command.type) {
    case 'power':
      state.power = command.value
      break
    case 'temperature':
      state.temperature = command.value
      break
    case 'mode':
      state.mode = command.value
      break
    case 'fan':
      state.fan = command.value
      break
    case 'brightness':
      state.brightness = command.value
      break
    case 'color':
      state.color = command.value
      break
  }
  return { ...device, state }
}

export interface DevicesApi {
  devices: Device[]
  statuses: DriverStatus[]
  loading: boolean
  /** Aparelhos com comando em voo. */
  pending: ReadonlySet<string>
  error: string | null
  refresh: () => Promise<void>
  send: (device: Device, command: Command) => Promise<void>
}

export function useDevices(enabled: boolean): DevicesApi {
  const [devices, setDevices] = useState<Device[]>([])
  const [statuses, setStatuses] = useState<DriverStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  // Evita que uma resposta atrasada sobrescreva um refresh mais novo.
  const requestId = useRef(0)

  const refresh = useCallback(async () => {
    if (!enabled) return
    const id = ++requestId.current
    setLoading(true)
    const result = await window.home.listDevices()
    if (id !== requestId.current) return

    if (result.ok) {
      setDevices(result.data.devices)
      setStatuses(result.data.statuses)
      setError(result.data.statuses.find((status) => status.error)?.error ?? null)
    } else {
      setError(result.error)
    }
    setLoading(false)
  }, [enabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const send = useCallback(async (device: Device, command: Command) => {
    const optimistic = applyOptimistic(device, command)
    setDevices((current) => current.map((item) => (item.id === device.id ? optimistic : item)))
    setPending((current) => new Set(current).add(device.id))
    setError(null)

    const result = await window.home.sendCommand({
      driverId: device.driverId,
      deviceId: device.id,
      command
    })

    setDevices((current) =>
      current.map((item) =>
        item.id === device.id ? (result.ok ? result.data : device) : item
      )
    )
    setPending((current) => {
      const next = new Set(current)
      next.delete(device.id)
      return next
    })
    if (!result.ok) setError(result.error)
  }, [])

  return { devices, statuses, loading, pending, error, refresh, send }
}
