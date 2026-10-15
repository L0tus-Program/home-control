import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'

const { RealtimeHub } = await loadSource('src/main/realtime/hub.ts')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const light = (id, state = {}) => ({ id, driverId: 'tuya', name: id, kind: 'light', capabilities: [], state: { online: true, power: false, ...state } })

/** Driver falso: guarda o listener para o teste emitir eventos quando quiser. */
function fakeDriver(id, { configured = true, watch = true, fail } = {}) {
  const driver = {
    id, label: id, listener: null, stops: 0,
    isConfigured: () => configured,
    listDevices: async () => [], getDevice: async () => { throw new Error('nao usado') }, execute: async () => {}
  }
  if (watch) {
    driver.watch = async (listener) => {
      if (fail) throw new Error(fail)
      driver.listener = listener
      return { stop: async () => { driver.stops++ } }
    }
  }
  return driver
}

function recorder() {
  const out = { batches: [], statuses: [] }
  out.output = { events: (batch) => out.batches.push(batch), status: (statuses) => out.statuses.push(statuses) }
  return out
}

test('agrupa a rajada de eventos por aparelho e mantem so o ultimo estado', async () => {
  const out = recorder()
  const hub = new RealtimeHub(out.output, 10)
  const tuya = fakeDriver('tuya')
  await hub.restart([tuya])
  tuya.listener.event({ type: 'state', device: light('a', { power: true }) })
  tuya.listener.event({ type: 'state', device: light('b') })
  tuya.listener.event({ type: 'state', device: light('a', { power: false, brightness: 40 }) })
  tuya.listener.event({ type: 'availability', deviceId: 'a', online: false })
  tuya.listener.event({ type: 'availability', deviceId: 'c', online: false })
  tuya.listener.event({ type: 'refresh' })
  tuya.listener.event({ type: 'refresh' })
  assert.equal(out.batches.length, 0)
  await wait(30)
  assert.equal(out.batches.length, 1)
  const { driverId, events } = out.batches[0]
  assert.equal(driverId, 'tuya')
  assert.deepEqual(events.map((e) => e.type === 'state' ? `state:${e.device.id}` : e.type === 'availability' ? `availability:${e.deviceId}` : e.type), [
    'state:b', 'state:a', 'availability:c', 'refresh'
  ])
  const a = events.find((e) => e.type === 'state' && e.device.id === 'a').device
  assert.deepEqual(a.state, { online: false, power: false, brightness: 40 })
})

test('status de cada driver: sem watch fica off, falha no watch vira unavailable', async () => {
  const out = recorder()
  const hub = new RealtimeHub(out.output, 10)
  await hub.restart([fakeDriver('thinq', { watch: false }), fakeDriver('off', { configured: false }), fakeDriver('tuya', { fail: 'sem rede' })])
  await wait(0)
  assert.deepEqual(hub.getStatuses(), { thinq: { state: 'off' }, off: { state: 'off' }, tuya: { state: 'unavailable', error: 'sem rede' } })
})

test('restart para o canal anterior e descarta eventos dele', async () => {
  const out = recorder()
  const hub = new RealtimeHub(out.output, 5)
  const old = fakeDriver('tuya')
  await hub.restart([old])
  old.listener.status('live')
  old.listener.event({ type: 'state', device: light('a') })
  const fresh = fakeDriver('tuya')
  await hub.restart([fresh])
  assert.equal(old.stops, 1)
  old.listener.event({ type: 'state', device: light('velho') })
  old.listener.status('live')
  assert.deepEqual(hub.getStatuses(), { tuya: { state: 'connecting' } })
  fresh.listener.event({ type: 'state', device: light('novo') })
  await wait(20)
  assert.deepEqual(out.batches.map((b) => b.events.map((e) => e.device.id)), [['novo']])
  await hub.stop()
  assert.equal(fresh.stops, 1)
  assert.deepEqual(hub.getStatuses(), {})
})

test('resync pede releitura so dos drivers ao vivo', async () => {
  const out = recorder()
  const hub = new RealtimeHub(out.output, 5)
  const live = fakeDriver('tuya')
  const connecting = fakeDriver('thinq')
  await hub.restart([live, connecting])
  live.listener.status('live')
  hub.resync()
  await wait(20)
  assert.deepEqual(out.batches, [{ driverId: 'tuya', events: [{ type: 'refresh' }] }])
  assert.deepEqual(out.statuses.at(-1), { tuya: { state: 'live' }, thinq: { state: 'connecting' } })
})
