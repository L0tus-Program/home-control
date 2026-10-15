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
const { executeCommand } = await loadSource('src/main/drivers/registry.ts', {
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

test('hub entrega o proximo estado do aparelho na hora, mesmo antes do wait; sem canal ao vivo nao espera', async () => {
  const hub = new RealtimeHub({ events: () => {}, status: () => {} }, 50)
  let listener
  const driver = { id: 'thinq', label: 'LG', isConfigured: () => true, watch: async (l) => { listener = l; return { stop: async () => {} } } }
  await hub.restart([driver])
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(hub.waitForState('thinq', 'ar'), null, 'conectando ainda')
  listener.status('live')
  const early = hub.waitForState('thinq', 'ar')
  listener.event({ type: 'state', device: { id: 'ar', driverId: 'thinq', state: { power: true } } })
  assert.deepEqual((await early.wait(1000)).state, { power: true })
  const late = hub.waitForState('thinq', 'ar')
  const pending = late.wait(1000)
  listener.event({ type: 'state', device: { id: 'outro', driverId: 'thinq', state: {} } })
  listener.event({ type: 'state', device: { id: 'ar', driverId: 'thinq', state: { power: false } } })
  assert.deepEqual((await pending).state, { power: false })
  assert.equal(await hub.waitForState('thinq', 'ar').wait(20), null)
  await hub.stop()
})
