import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deviceKey } from '../../../shared/devices'
import type { Command, Device, DriverStatus, RealtimeStatus } from '../../../shared/types'
import { applyDeviceEvents } from './deviceEvents'

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
    case 'colorTemperature':
      // O tom do branco tira a lampada do modo cor.
      state.colorTemperature = command.value
      state.color = undefined
      if (state.mode) state.mode = 'white'
      break
  }
  return { ...device, state }
}

export interface HomeRead {
  devices: Device[]
  statuses: DriverStatus[]
}

const EMPTY: HomeRead = { devices: [], statuses: [] }

/**
 * Aplica uma leitura da nuvem sobre o que ja esta em memoria. So os drivers
 * consultados sao trocados, a ordem dos drivers se mantem (a lista do comodo
 * segue essa ordem) e um driver que falhou continua mostrando
 * os ultimos aparelhos conhecidos em vez de sumir da casa.
 */
export function mergeRead(current: HomeRead, fresh: HomeRead, queried: string[], keepCurrent: (key: string) => boolean = () => false): HomeRead {
  const known = [...current.statuses, ...fresh.statuses.filter((item) => !current.statuses.some((status) => status.id === item.id))]
  const statuses = known.map((status) =>
    queried.includes(status.id) ? fresh.statuses.find((item) => item.id === status.id) ?? status : status
  )
  const devices = statuses.flatMap((status) => {
    const source = queried.includes(status.id) && !(status.error && status.configured) ? fresh.devices : current.devices
    return source.filter((device) => device.driverId === status.id).map((device) => {
      // Um evento chegou depois que esta leitura comecou: ele e mais novo.
      const key = deviceKey(device)
      return keepCurrent(key) ? current.devices.find((item) => deviceKey(item) === key) ?? device : device
    })
  })
  return { devices, statuses }
}

/** Releitura pedida por evento (aparelho novo, removido, reconexao): espera a rajada passar... */
const EVENT_REFRESH_DELAY_MS = 1500
/** ...e no maximo uma por driver neste intervalo, para nao gastar a cota da LG. */
const EVENT_REFRESH_MIN_INTERVAL_MS = 30_000

export interface DevicesApi {
  devices: Device[]
  statuses: DriverStatus[]
  loading: boolean
  /** Aparelhos com comando em voo, usando driverId:id. */
  pending: ReadonlySet<string>
  /** Falha de IPC ou de comando. Falhas de cada driver ficam em statuses. */
  error: string | null
  /** Busca todos os drivers, ou so um, sem apagar o que ja esta na tela. */
  refresh: (driverId?: string) => Promise<void>
  /** So vai a nuvem se o dado tiver mais de maxAgeMs (ou nunca tiver chegado). */
  refreshIfStale: (maxAgeMs: number, driverId?: string) => void
  send: (device: Device, command: Command) => Promise<void>
}

/**
 * Fonte unica de aparelhos da app. O resultado fica guardado enquanto a app
 * estiver aberta, entao trocar de tela nao volta a consultar LG/Tuya.
 */
export function useDevices(enabled: boolean, revision = 0): DevicesApi {
  const [home, setHome] = useState<HomeRead>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [realtime, setRealtime] = useState<Record<string, RealtimeStatus>>({})

  // Evita que uma resposta atrasada sobrescreva um refresh mais novo.
  const requestId = useRef(0)
  const contextId = useRef(0)
  const inFlight = useRef(false)
  // Quando cada driver foi lido pela ultima vez; 'all' marca a carga completa.
  const updatedAt = useRef(new Map<string, number>())
  // Quando cada aparelho foi atualizado por evento; protege contra leituras mais velhas.
  const eventAt = useRef(new Map<string, number>())
  // Comandos em voo por aparelho, atualizado na hora (o estado `pending` so no proximo render).
  const pendingCounts = useRef(new Map<string, number>())
  const pendingKeys = useRef<ReadonlySet<string>>(new Set())
  const homeRef = useRef(home)
  homeRef.current = home

  /** `background`: pedida por evento; nao pisca o indicador de carregamento. */
  const refresh = useCallback(async (driverId?: string, background = false) => {
    if (!enabled) return
    const id = ++requestId.current
    const startedAt = Date.now()
    inFlight.current = true
    if (!background) setLoading(true)
    const result = await window.home.listDevices(driverId).catch((cause: unknown) => ({
      ok: false as const, error: cause instanceof Error ? cause.message : 'Não consegui carregar os aparelhos.'
    }))
    if (id !== requestId.current) return
    inFlight.current = false

    if (result.ok) {
      const now = Date.now()
      const queried = driverId ? [driverId] : result.data.statuses.map((status) => status.id)
      setHome((current) => mergeRead(current, result.data, queried, (key) => (eventAt.current.get(key) ?? 0) > startedAt))
      for (const queriedId of queried) updatedAt.current.set(queriedId, now)
      if (!driverId) updatedAt.current.set('all', now)
      setError(null)
    } else {
      setError(result.error)
    }
    setLoading(false)
  }, [enabled])

  const refreshIfStale = useCallback((maxAgeMs: number, driverId?: string) => {
    if (inFlight.current) return
    const last = updatedAt.current.get(driverId ?? 'all')
    if (last === undefined || Date.now() - last > maxAgeMs) void refresh(driverId)
  }, [refresh])

  // Tempo real: estado que chega sozinho, sem consultar a nuvem.
  useEffect(() => {
    if (!enabled) return
    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const lastAuto = new Map<string, number>()
    // Aparelhos que continuaram fora da lista depois de uma releitura nao pedem outra.
    const unknownSeen = new Set<string>()
    const refreshSoon = (driverId: string): void => {
      if (timers.has(driverId)) return
      const since = Date.now() - (lastAuto.get(driverId) ?? -Infinity)
      const delay = Math.max(EVENT_REFRESH_DELAY_MS, EVENT_REFRESH_MIN_INTERVAL_MS - since)
      const run = (): void => {
        // Nunca cancela uma leitura em andamento (a carga inicial, por exemplo): espera ela.
        if (inFlight.current) {
          timers.set(driverId, setTimeout(run, EVENT_REFRESH_DELAY_MS))
          return
        }
        timers.delete(driverId)
        lastAuto.set(driverId, Date.now())
        void refresh(driverId, true)
      }
      timers.set(driverId, setTimeout(run, delay))
    }
    const stopEvents = window.home.onDeviceEvents((batch) => {
      // A analise usa a lista ja desenhada; o atualizador reaplica sobre a mais recente.
      const seen = applyDeviceEvents(homeRef.current.devices, batch, pendingKeys.current)
      const now = Date.now()
      for (const key of seen.touched) eventAt.current.set(key, now)
      setHome((current) => {
        const applied = applyDeviceEvents(current.devices, batch, pendingKeys.current)
        return applied.devices === current.devices ? current : { ...current, devices: applied.devices }
      })
      const fresh = seen.unknown.filter((key) => !unknownSeen.has(key))
      for (const key of fresh) unknownSeen.add(key)
      if (seen.needsRefresh || fresh.length > 0) refreshSoon(batch.driverId)
    })
    const stopStatus = window.home.onRealtimeStatus(setRealtime)
    void window.home.getRealtimeStatus().then((result) => { if (result.ok) setRealtime(result.data) }).catch(() => undefined)
    return () => {
      stopEvents()
      stopStatus()
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [enabled, refresh])

  useEffect(() => {
    // So limpa quando as credenciais mudam ou a casa e desconectada.
    contextId.current += 1
    updatedAt.current.clear()
    eventAt.current.clear()
    pendingCounts.current.clear()
    pendingKeys.current = new Set()
    setHome(EMPTY)
    setPending(new Set())
    setError(null)
    setLoading(false)
    void refresh()
    return () => { requestId.current += 1; contextId.current += 1; inFlight.current = false }
  }, [refresh, revision])

  const send = useCallback(async (device: Device, command: Command) => {
    const context = contextId.current
    const key = deviceKey(device)
    const optimistic = applyOptimistic(device, command)
    const replace = (next: Device): void => setHome((current) => ({
      ...current,
      devices: current.devices.map((item) => (deviceKey(item) === key ? next : item))
    }))
    replace(optimistic)
    const counts = pendingCounts.current
    counts.set(key, (counts.get(key) ?? 0) + 1)
    pendingKeys.current = new Set(counts.keys())
    setPending(pendingKeys.current)
    setError(null)

    const result = await window.home.sendCommand({
      driverId: device.driverId,
      deviceId: device.id,
      command
    }).catch((cause: unknown) => ({
      ok: false as const, error: cause instanceof Error ? cause.message : 'Não consegui enviar o comando.'
    }))
    if (context !== contextId.current) return

    // Dois comandos seguidos no mesmo aparelho: so libera quando o ultimo termina.
    const left = (counts.get(key) ?? 1) - 1
    if (left > 0) counts.set(key, left)
    else counts.delete(key)
    pendingKeys.current = new Set(counts.keys())
    setPending(pendingKeys.current)
    // Com tempo real, a resposta ja e o evento que confirmou o valor pedido.
    if (left === 0) replace(result.ok ? result.data : device)
    if (!result.ok) setError(result.error)
  }, [])

  const statuses = useMemo(
    () => home.statuses.map((status) => (realtime[status.id] ? { ...status, realtime: realtime[status.id] } : status)),
    [home.statuses, realtime]
  )

  return { devices: home.devices, statuses, loading, pending, error, refresh, refreshIfStale, send }
}
