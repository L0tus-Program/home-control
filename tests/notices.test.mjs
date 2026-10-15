import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'
import { fakeBroker, until } from './fake-mqtt.mjs'

const { ThinqDriver, pushMessage } = await loadSource('src/main/drivers/thinq/driver.ts')
const { RealtimeHub } = await loadSource('src/main/realtime/hub.ts')
const { applyDeviceEvents } = await loadSource('src/renderer/src/hooks/deviceEvents.ts')

const profile = { property: { operation: { airConOperationMode: { type: 'enum', mode: ['r', 'w'], value: { w: ['POWER_ON', 'POWER_OFF'] } } },
  filterInfo: { filterLifetime: { type: 'number', mode: ['r'] }, usedTime: { type: 'number', mode: ['r'] } } }, notification: { push: ['WATER_IS_FULL'] } }

function client(state, calls = []) {
  return {
    calls, clientId: 'c',
    listDevices: async () => [{ deviceId: 'ar', deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER', alias: 'Ar do quarto' } }],
    getProfile: async () => profile,
    getState: async () => state,
    control: async () => {},
    registerClient: async () => {},
    getRoute: async () => ({ mqttServer: 'mqtts://abc-ats.iot.us-west-2.amazonaws.com:8883' }),
    subscribeEvents: async (id) => { calls.push(`events:${id}`) },
    subscribePush: async (id) => { calls.push(`push:${id}`) },
    subscribeDeviceList: async () => { calls.push('deviceList') }
  }
}

test('filtro: horas de uso; vida util zero e desconhecida', async () => {
  const [device] = await new ThinqDriver(client({ filterInfo: { filterLifetime: 0, usedTime: 720 } })).listDevices()
  assert.deepEqual(device.state.filter, { usedHours: 720 })
  const [full] = await new ThinqDriver(client({ filterInfo: { filterLifetime: 1000, usedTime: 250, filterRemainPercent: 75 } })).listDevices()
  assert.deepEqual(full.state.filter, { usedHours: 250, lifetimeHours: 1000, remainingPercent: 75 })
})

test('aviso DEVICE_PUSH vira notice com o nome do aparelho; assina push por aparelho', async (t) => {
  const broker = fakeBroker()
  const api = client({ operation: { airConOperationMode: 'POWER_ON' } })
  const out = { events: [], statuses: [] }
  const listener = { event: (e) => out.events.push(e), status: (s) => out.statuses.push(s) }
  const stored = { clientId: 'c', privateKeyPem: 'K', certificatePem: 'C', subscriptions: ['t'] }
  const handle = await new ThinqDriver(api, { loadCredentials: () => stored, connect: broker.connect }).watch(listener)
  t.after(() => handle.stop())
  await until(() => out.statuses.includes('live'))
  assert.ok(api.calls.includes('push:ar'))
  broker.last().deliver('t', { pushType: 'DEVICE_PUSH', deviceId: 'ar', pushCode: 'WATER_IS_FULL' })
  assert.deepEqual(out.events.at(-1), { type: 'notice', deviceId: 'ar', title: 'Ar do quarto', message: 'O reservatório de água está cheio.' })
  assert.equal(pushMessage('SOMETHING_NEW'), 'Aviso do aparelho: something new.')
})

test('hub entrega avisos distintos e junta repetidos; renderer nao mexe nos aparelhos', async () => {
  const batches = []
  const hub = new RealtimeHub({ events: (b) => batches.push(b), status: () => {} }, 5)
  let listener
  await hub.restart([{ id: 'thinq', label: 'LG', isConfigured: () => true, watch: async (l) => { listener = l; return { stop: async () => {} } } }])
  await new Promise((resolve) => setImmediate(resolve))
  const notice = (message) => ({ type: 'notice', deviceId: 'ar', title: 'Ar', message })
  listener.event(notice('a'))
  listener.event(notice('a'))
  listener.event(notice('b'))
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(batches[0].events.map((e) => e.message), ['a', 'b'])
  const list = [{ id: 'ar', driverId: 'thinq', state: { online: true, power: true } }]
  const applied = applyDeviceEvents(list, batches[0], new Set())
  assert.equal(applied.devices, list)
  assert.equal(applied.needsRefresh, false)
  await hub.stop()
})
