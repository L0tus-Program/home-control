import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'
import { fakeBroker, tick, until } from './fake-mqtt.mjs'

const { parseTuyaMessage, resolveReport, mergeStatus } = await loadSource('src/main/drivers/tuya/realtime.ts')
const { TuyaDriver } = await loadSource('src/main/drivers/tuya/driver.ts')

const functions = [
  { code: 'switch_led', type: 'Boolean', values: '{}' },
  { code: 'bright_value_v2', type: 'Integer', values: '{"min":10,"max":1000,"step":1}' },
  { code: 'colour_data_v2', type: 'Json', values: '{}' },
  { code: 'work_mode', type: 'Enum', values: '{"range":["white","colour"]}' }
]

test('mensagens: estado (protocolo 4) e avisos da conta (protocolo 20)', () => {
  assert.deepEqual(parseTuyaMessage({ protocol: 4, data: { devId: 'luz', status: [{ code: 'switch_led', value: true, t: 1 }, { dpId: 22, value: 500 }, { nada: 1 }] } }),
    { kind: 'status', devId: 'luz', items: [{ code: 'switch_led', value: true }, { dpId: '22', value: 500 }] })
  assert.deepEqual(parseTuyaMessage({ protocol: 20, data: { bizCode: 'offline', bizData: { devId: 'luz' } } }), { kind: 'availability', devId: 'luz', online: false })
  assert.deepEqual(parseTuyaMessage({ protocol: 20, data: { bizCode: 'delete', bizData: { devId: 'luz' } } }), { kind: 'changed', devId: 'luz', topology: true })
  assert.deepEqual(parseTuyaMessage({ protocol: 20, data: { bizCode: 'nameUpdate', bizData: { devId: 'luz', name: 'x' } } }), { kind: 'changed', devId: 'luz', topology: false })
  for (const bad of [null, 'x', { protocol: 4 }, { protocol: 4, data: { devId: 'luz', status: [] } }, { protocol: 20, data: { bizCode: 'dpNameUpdate', bizData: { devId: 'luz' } } }, { protocol: 9, data: {} }]) {
    assert.equal(parseTuyaMessage(bad), null)
  }
})

test('dpId so e aceito com traducao conhecida e valor no formato do codigo', () => {
  const device = { id: 'luz', name: 'Luz', category: 'dj', online: true, local: { dps: {
    20: { code: 'switch_led', convert: 'default' }, 22: { code: 'bright_value_v2' }, 24: { code: 'colour_data_v2' }, 26: { code: 'work_mode', convert: 'enum' }
  } } }
  const ok = resolveReport([{ dpId: '20', value: false }, { dpId: '22', value: 300 }, { code: 'work_mode', value: 'white' }], device, functions)
  assert.deepEqual(ok, { updates: [{ code: 'switch_led', value: false }, { code: 'bright_value_v2', value: 300 }, { code: 'work_mode', value: 'white' }], unresolved: false })
  for (const item of [{ dpId: '24', value: '00f003e803e8' }, { dpId: '26', value: 'white' }, { dpId: '22', value: '300' }]) {
    const result = resolveReport([item], device, functions)
    assert.deepEqual(result.updates, [], JSON.stringify(item))
    assert.equal(result.unresolved, true)
  }
  assert.deepEqual(resolveReport([{ dpId: '24', value: '{"h":10,"s":1000,"v":1000}' }], device, functions).unresolved, false)
  // dpId sem traducao ou de codigo que o app nao usa: ignorado, sem releitura.
  const withScene = { ...device, local: { dps: { ...device.local.dps, 25: { code: 'scene_data_v2', convert: 'scene' } } } }
  assert.deepEqual(resolveReport([{ dpId: '99', value: 1 }, { dpId: '25', value: 'x' }], withScene, functions), { updates: [], unresolved: false })
  assert.deepEqual(mergeStatus([{ code: 'a', value: 1 }, { code: 'b', value: 2 }], [{ code: 'b', value: 3 }, { code: 'c', value: 4 }]),
    [{ code: 'a', value: 1 }, { code: 'b', value: 3 }, { code: 'c', value: 4 }])
})

function sharingFixture(overrides = {}) {
  const calls = { getDevice: 0 }
  return {
    calls,
    listDevices: async () => [
      { id: 'luz', category: 'dj', name: 'Sala', online: true, status: [{ code: 'switch_led', value: false }, { code: 'bright_value_v2', value: 500 }, { code: 'work_mode', value: 'white' }] },
      { id: 'local', category: 'dj', name: 'Apoio', online: true, local: { dps: { 20: { code: 'switch_led' }, 24: { code: 'colour_data_v2', convert: 'hex' } } }, status: [{ code: 'switch_led', value: false }] },
      { id: 'tomada', category: 'cz', name: 'Tomada', online: true, status: [] }
    ],
    getDevice: async (id) => { calls.getDevice++; return { id, category: 'dj', name: 'Sala', online: true, status: [{ code: 'switch_led', value: true }, { code: 'bright_value_v2', value: 900 }] } },
    getStatus: async () => [],
    getFunctions: async () => ({ functions }),
    sendCommands: async () => {},
    listHomeIds: async () => ['12'],
    getMqttConfig: async () => ({
      url: 'ssl://m1.tuyaus.com:8883', clientId: 'cli', username: 'user', password: 'pass', expireTime: 7200,
      ownerTopic: 'cloud/token/in/{ownerId}', deviceTopic: 'cloud/token/in/{devId}'
    }),
    ...overrides
  }
}

function listen() {
  const out = { events: [], statuses: [] }
  out.listener = { event: (event) => out.events.push(event), status: (state, error) => out.statuses.push(error ? `${state}:${error}` : state) }
  return out
}

test('watch assina casa e lampadas, aplica relato parcial e avisos de disponibilidade', async (t) => {
  const broker = fakeBroker()
  const driver = new TuyaDriver(sharingFixture(), broker.connect)
  const out = listen()
  const handle = await driver.watch(out.listener)
  t.after(() => handle.stop())
  await tick(20)
  const client = broker.last()
  assert.equal(client.url, 'mqtts://m1.tuyaus.com:8883')
  assert.equal(client.options.username, 'user')
  assert.deepEqual(client.subscribed, ['cloud/token/in/12', 'cloud/token/in/luz/sta', 'cloud/token/in/local/pen'])
  assert.deepEqual(out.statuses, ['connecting', 'live'])

  client.deliver('cloud/token/in/luz/sta', { protocol: 4, data: { devId: 'luz', status: [{ code: 'switch_led', value: true }] } })
  client.deliver('cloud/token/in/local/pen', { protocol: 4, data: { devId: 'local', status: [{ dpId: 20, value: true }] } })
  client.deliver('x', { protocol: 4, data: { devId: 'tomada', status: [{ code: 'switch_1', value: true }] } })
  client.deliver('x', { protocol: 20, data: { bizCode: 'offline', bizData: { devId: 'luz' } } })
  client.deliver('x', 'nao e json')
  const states = out.events.filter((e) => e.type === 'state')
  assert.deepEqual(states.map((e) => [e.device.id, e.device.state.power]), [['luz', true], ['local', true]])
  assert.equal(states[0].device.state.brightness, 50, 'mantem o brilho da leitura anterior')
  assert.equal(states[0].device.driverId, 'tuya')
  assert.deepEqual(out.events.at(-1), { type: 'availability', deviceId: 'luz', online: false })
  await handle.stop()
  assert.equal(client.ended, true)
})

test('relato que nao sabemos traduzir rele o aparelho pela nuvem, uma vez', async () => {
  const broker = fakeBroker()
  const api = sharingFixture()
  const driver = new TuyaDriver(api, broker.connect)
  const out = listen()
  const handle = await driver.watch(out.listener)
  await tick(20)
  const client = broker.last()
  for (let i = 0; i < 3; i++) client.deliver('t', { protocol: 4, data: { devId: 'local', status: [{ dpId: 24, value: '00f003e803e8' }] } })
  assert.equal(out.events.length, 0)
  await tick(1100)
  assert.equal(api.calls.getDevice, 1)
  assert.equal(out.events.length, 1)
  assert.equal(out.events[0].device.state.power, true)
  await handle.stop()
})

test('aparelho novo ou removido pede releitura e refaz a conexao com os topicos novos', async () => {
  const broker = fakeBroker()
  const driver = new TuyaDriver(sharingFixture(), broker.connect)
  const out = listen()
  const handle = await driver.watch(out.listener)
  await tick(20)
  broker.last().deliver('t', { protocol: 20, data: { bizCode: 'bindUser', bizData: { devId: 'nova' } } })
  assert.deepEqual(out.events, [{ type: 'refresh' }])
  await tick(3200)
  assert.equal(broker.clients.length, 2)
  assert.equal(broker.clients[0].ended, true)
  await handle.stop()
})

test('conexao por projeto cloud nao tem tempo real; dominio fora da lista e recusado', async () => {
  const cloudOnly = sharingFixture()
  delete cloudOnly.getMqttConfig
  const out = listen()
  await (await new TuyaDriver(cloudOnly).watch(out.listener)).stop()
  assert.deepEqual(out.statuses, ['off'])

  const broker = fakeBroker()
  const evil = sharingFixture({ getMqttConfig: async () => ({ url: 'ssl://evil.example.com:8883', clientId: 'c', username: 'u', password: 'p', expireTime: 7200, ownerTopic: '{ownerId}', deviceTopic: '{devId}' }) })
  const out2 = listen()
  const handle = await new TuyaDriver(evil, broker.connect).watch(out2.listener)
  await tick(20)
  assert.equal(broker.clients.length, 0, 'senha nunca vai para outro dominio')
  assert.match(out2.statuses.join(), /fora do domínio oficial/)
  await handle.stop()
})

test('sessao removida para de tentar', async (t) => {
  let calls = 0
  const api = sharingFixture({ getMqttConfig: async () => { calls++; throw Object.assign(new Error('Conecte de novo'), { code: '1010' }) } })
  const out = listen()
  const handle = await new TuyaDriver(api, fakeBroker().connect).watch(out.listener)
  t.after(() => handle.stop())
  await tick(1500)
  assert.equal(calls, 1)
  assert.equal(out.statuses.at(-1), 'unavailable:Conecte de novo')
})

test('leitura REST que comecou antes de um relato nao desfaz o relato', async (t) => {
  const broker = fakeBroker()
  let release
  const api = sharingFixture({
    getDevice: async (id) => {
      await new Promise((resolve) => { release = resolve })
      return { id, category: 'dj', name: 'Sala', online: true, status: [{ code: 'switch_led', value: false }, { code: 'bright_value_v2', value: 500 }] }
    }
  })
  const driver = new TuyaDriver(api, broker.connect)
  const out = listen()
  const handle = await driver.watch(out.listener)
  t.after(() => handle.stop())
  await until(() => out.statuses.includes('live'))
  const reading = driver.getDevice('luz')
  await tick(5)
  broker.last().deliver('t', { protocol: 4, data: { devId: 'luz', status: [{ code: 'switch_led', value: true }] } })
  release()
  assert.equal((await reading).state.power, true, 'o relato do MQTT e mais novo que a leitura')
  broker.last().deliver('t', { protocol: 4, data: { devId: 'luz', status: [{ code: 'bright_value_v2', value: 1000 }] } })
  assert.equal(out.events.at(-1).device.state.power, true, 'o cache manteve o relato')
})

test('leitura REST e a base e os relatos chegados durante ela vao por cima', async (t) => {
  const broker = fakeBroker()
  let release
  const api = sharingFixture({
    getDevice: async (id) => {
      await new Promise((resolve) => { release = resolve })
      // A nuvem traz um brilho que o canal perdeu e a energia ainda antiga.
      return { id, category: 'dj', name: 'Sala', online: true, status: [{ code: 'switch_led', value: false }, { code: 'bright_value_v2', value: 1000 }, { code: 'work_mode', value: 'white' }] }
    }
  })
  const driver = new TuyaDriver(api, broker.connect)
  const out = listen()
  const handle = await driver.watch(out.listener)
  t.after(() => handle.stop())
  await until(() => out.statuses.includes('live'))
  const reading = driver.getDevice('luz')
  await tick(5)
  broker.last().deliver('t', { protocol: 4, data: { devId: 'luz', status: [{ code: 'switch_led', value: true }] } })
  release()
  const device = await reading
  assert.equal(device.state.power, true, 'relato mais novo vence')
  assert.equal(device.state.brightness, 100, 'o resto vem da leitura')
})
