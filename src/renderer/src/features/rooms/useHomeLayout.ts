import { useEffect, useRef, useState } from 'react'
import {
  assetForDeviceKind,
  createHomeLayout,
  deviceRefKey,
  knownDeviceKeys,
  placeNewDevices,
  type DeviceCandidate,
  type HomeLayout
} from '../../../../shared/home'
import type { Device } from '../../../../shared/types'

function candidates(layout: HomeLayout, devices: Device[]): DeviceCandidate[] {
  const known = knownDeviceKeys(layout)
  return devices
    .map((device) => ({ driverId: device.driverId, deviceId: device.id, kind: device.kind }))
    .filter((device) => assetForDeviceKind(device.kind) && !known.has(deviceRefKey(device)))
}

/**
 * Layout salvo da casa. Aparelhos conectados que o layout nunca viu sao
 * entregues ao processo principal, que os poe no comodo base e grava.
 *
 * Se o layout nao puder ser lido, a sala padrao segue em memoria para a
 * maquete continuar utilizavel, sem gravar nada.
 */
export function useHomeLayout(devices: Device[]): HomeLayout | null {
  const [layout, setLayout] = useState<HomeLayout | null>(null)
  const [persisted, setPersisted] = useState(true)
  const placing = useRef(false)

  useEffect(() => {
    let active = true
    void window.home.getHomeLayout()
      .catch(() => ({ ok: false as const, error: 'IPC indisponível' }))
      .then((result) => {
        if (!active) return
        if (result.ok) setLayout(result.data)
        else {
          setPersisted(false)
          setLayout(createHomeLayout())
        }
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!layout || placing.current) return
    const missing = candidates(layout, devices)
    if (!missing.length) return
    if (!persisted) {
      setLayout(placeNewDevices(layout, missing).layout)
      return
    }
    placing.current = true
    void window.home.placeDevices(missing)
      .catch(() => null)
      .then((result) => {
        placing.current = false
        // Em falha fica como esta; a proxima mudanca de aparelhos tenta de novo.
        if (result?.ok) setLayout(result.data)
      })
  }, [layout, devices, persisted])

  return layout
}
