import { useCallback, useEffect, useRef, useState } from 'react'
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

export interface HomeLayoutApi {
  layout: HomeLayout | null
  /**
   * Grava um layout derivado do atual (mesma `revision`). Devolve a mensagem
   * de erro, se houver; em conflito o layout volta ao que esta no disco.
   */
  commit: (next: HomeLayout) => Promise<string | null>
}

/**
 * Layout salvo da casa. Aparelhos conectados que o layout nunca viu sao
 * entregues ao processo principal, que os poe no comodo base e grava;
 * `paused` suspende isso enquanto um rascunho esta sendo editado.
 *
 * Se o layout nao puder ser lido, a sala padrao segue em memoria para a
 * maquete continuar utilizavel, sem gravar nada.
 */
export function useHomeLayout(devices: Device[], paused = false): HomeLayoutApi {
  const [layout, setLayout] = useState<HomeLayout | null>(null)
  const [persisted, setPersisted] = useState(true)
  const current = useRef<HomeLayout | null>(null)
  // Gravacoes em fila: cada uma parte da revisao que a anterior deixou.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const placing = useRef(false)

  const apply = useCallback((next: HomeLayout) => {
    current.current = next
    setLayout(next)
  }, [])

  const reload = useCallback(async () => {
    const result = await window.home.getHomeLayout()
      .catch(() => ({ ok: false as const, error: 'IPC indisponível' }))
    if (result.ok) apply(result.data)
    else if (!current.current) {
      setPersisted(false)
      apply(createHomeLayout())
    }
  }, [apply])

  useEffect(() => { void reload() }, [reload])

  const commit = useCallback((next: HomeLayout): Promise<string | null> => {
    const run = queue.current.then(async () => {
      if (!current.current) return 'O layout ainda não carregou.'
      if (!persisted) {
        apply(next)
        return null
      }
      // A revisao de `next` e a que ele leu: se o disco andou, e conflito.
      const result = await window.home.saveHomeLayout(next, next.revision)
        .catch((cause: unknown) => ({ ok: false as const, error: cause instanceof Error ? cause.message : 'Não consegui salvar o layout.' }))
      if (result.ok) {
        apply(result.data)
        return null
      }
      // Conflito ou arquivo trocado: volta ao que esta no disco.
      await reload()
      return result.error
    })
    queue.current = run
    return run
  }, [apply, persisted, reload])

  useEffect(() => {
    if (!layout || paused || placing.current) return
    const missing = candidates(layout, devices)
    if (!missing.length) return
    if (!persisted) {
      apply(placeNewDevices(layout, missing).layout)
      return
    }
    placing.current = true
    const run = queue.current.then(() => window.home.placeDevices(missing).catch(() => null))
    queue.current = run
    void run.then((result) => {
      placing.current = false
      // Em falha fica como esta; a proxima mudanca de aparelhos tenta de novo.
      if (result?.ok) apply(result.data)
    })
  }, [layout, devices, paused, persisted, apply])

  return { layout, commit }
}
