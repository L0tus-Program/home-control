import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'

const fakeDriver = `
  export const calls = globalThis.__confirmCalls = globalThis.__confirmCalls ?? []
  export const THINQ_DRIVER_ID = 'thinq'
  export class ThinqDriver {
    id = 'thinq'; label = 'LG'
    isConfigured() { return true }
    async execute(id, command) { calls.push(['execute', id, command.type]); if (command.type === 'mode') throw new Error('recusado') }
    async getDevice(id) { calls.push(['getDevice', id]); return { id, driverId: 'thinq', state: { lido: true } } }
  }
`
const { executeCommand, confirmsCommand } = await loadSource('src/main/drivers/registry.ts', {
  '../store': `
    export const getToken = () => null
    export const getCountry = () => 'BR'
    export const getClientId = () => 'c'
    export const getTuyaCredentials = () => null
    export const getTuyaRegion = () => 'us'
    export const getTuyaSession = () => null
    export const getThinqMqttCredentials = () => null
    export const setThinqMqttCredentials = () => {}
    export const setTuyaSession = () => {}
  `,
  './thinq/driver': fakeDriver
})
const { RealtimeHub } = await loadSource('src/main/realtime/hub.ts')

test('com tempo real, o evento confirma o comando sem ler a nuvem', async () => {
  globalThis.__confirmCalls.length = 0
  const device = { id: 'ar', driverId: 'thinq', state: { evento: true } }
  let cancelled = false
  const waiter = { wait: async () => device, cancel: () => { cancelled = true } }
  const result = await executeCommand('thinq', 'ar', { type: 'power', value: true }, () => waiter)
  assert.equal(result, device)
  assert.deepEqual(globalThis.__confirmCalls, [['execute', 'ar', 'power']])
  assert.equal(cancelled, false)
})

test('sem evento no prazo, confirma pela leitura; comando recusado cancela a espera', async () => {
  globalThis.__confirmCalls.length = 0
  const result = await executeCommand('thinq', 'ar', { type: 'power', value: true }, () => ({ wait: async () => null, cancel: () => {} }))
  assert.deepEqual(result.state, { lido: true })
  let cancelled = false
  await assert.rejects(executeCommand('thinq', 'ar', { type: 'mode', value: 'COOL' }, () => ({ wait: async () => null, cancel: () => { cancelled = true } })), /recusado/)
  assert.equal(cancelled, true)
})

test('hub: so o estado com o valor comandado confirma; evento antigo e ignorado', async () => {
  const hub = new RealtimeHub({ events: () => {}, status: () => {} }, 50)
  let listener
  const driver = { id: 'thinq', label: 'LG', isConfigured: () => true, watch: async (l) => { listener = l; return { stop: async () => {} } } }
  await hub.restart([driver])
  await new Promise((resolve) => setImmediate(resolve))
  const powerOn = confirmsCommand({ type: 'power', value: true })
  assert.equal(hub.waitForState('thinq', 'ar', powerOn), null, 'conectando ainda')
  listener.status('live')
  const ar = (state) => ({ id: 'ar', driverId: 'thinq', state })

  const early = hub.waitForState('thinq', 'ar', powerOn)
  listener.event({ type: 'state', device: ar({ power: false }) })
  listener.event({ type: 'state', device: { id: 'outro', driverId: 'thinq', state: { power: true } } })
  listener.event({ type: 'state', device: ar({ power: true, temperature: 22 }) })
  assert.deepEqual((await early.wait(1000)).state, { power: true, temperature: 22 })

  const late = hub.waitForState('thinq', 'ar', confirmsCommand({ type: 'temperature', value: 24 }))
  const pending = late.wait(1000)
  listener.event({ type: 'state', device: ar({ power: true, temperature: 23 }) })
  listener.event({ type: 'state', device: ar({ power: true, temperature: 24 }) })
  assert.deepEqual((await pending).state, { power: true, temperature: 24 })
  assert.equal(await hub.waitForState('thinq', 'ar', powerOn).wait(20), null, 'sem evento: cai na leitura')

  // Canal caiu: a espera termina na hora, sem esperar o prazo.
  const dropped = hub.waitForState('thinq', 'ar', powerOn)
  const started = Date.now()
  const result = dropped.wait(5000)
  listener.status('connecting')
  assert.equal(await result, null)
  assert.ok(Date.now() - started < 1000)

  listener.status('live')
  const onStop = hub.waitForState('thinq', 'ar', powerOn).wait(5000)
  await hub.stop()
  assert.equal(await onStop, null)
})

test('predicados de confirmacao por tipo de comando', () => {
  const device = (state) => ({ id: 'x', driverId: 'tuya', state: { online: true, power: true, ...state } })
  assert.equal(confirmsCommand({ type: 'brightness', value: 50 })(device({ brightness: 51 })), true)
  assert.equal(confirmsCommand({ type: 'brightness', value: 50 })(device({ brightness: 60 })), false)
  assert.equal(confirmsCommand({ type: 'color', value: { hue: 120, saturation: 80 } })(device({ color: { hue: 121, saturation: 79 } })), true)
  assert.equal(confirmsCommand({ type: 'color', value: { hue: 120, saturation: 80 } })(device({})), false)
  assert.equal(confirmsCommand({ type: 'mode', value: 'COOL' })(device({ mode: 'HEAT' })), false)
  assert.equal(confirmsCommand({ type: 'fan', value: 'LOW' })(device({ fan: 'LOW' })), true)
  assert.equal(confirmsCommand({ type: 'option', key: 'powerSave', value: true })(device({ options: { powerSave: true } })), true)
  assert.equal(confirmsCommand({ type: 'option', key: 'powerSave', value: false })(device({})), false, 'sem o ajuste no estado nao confirma')
})
