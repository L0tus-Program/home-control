import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'
import { fakeBroker, tick, until } from './fake-mqtt.mjs'

const { parseThinqMessage, mergeReport } = await loadSource('src/main/drivers/thinq/realtime.ts')
const { ThinqDriver } = await loadSource('src/main/drivers/thinq/driver.ts')

const writable = (w) => ({ mode: ['r', 'w'], value: { r: w, w } })
const profile = {
  property: {
    airConJobMode: { currentJobMode: writable(['COOL', 'HEAT', 'FAN']) },
    operation: { airConOperationMode: writable(['POWER_ON', 'POWER_OFF']) },
    airFlow: { windStrength: writable(['LOW', 'HIGH']) },
    temperatureInUnits: [
      { unit: 'C', targetTemperature: writable({ min: 16, max: 30, step: 1 }) },
      { unit: 'F', targetTemperature: writable({ min: 60, max: 86, step: 1 }) }
    ]
  }
}
const initialState = () => ({
  operation: { airConOperationMode: 'POWER_OFF' },
  airConJobMode: { currentJobMode: 'COOL' },
  airFlow: { windStrength: 'LOW' },
  temperatureInUnits: [{ unit: 'C', targetTemperature: 24, currentTemperature: 27 }, { unit: 'F', targetTemperature: 75, currentTemperature: 80 }]
})

test('mensagens: estado parcial, aviso e mudancas na conta', () => {
  assert.deepEqual(parseThinqMessage({ pushType: 'DEVICE_STATUS', deviceId: 'ar', deviceType: 'DEVICE_AIR_CONDITIONER', report: { operation: { airConOperationMode: 'POWER_ON' } } }),
    { kind: 'status', deviceId: 'ar', report: { operation: { airConOperationMode: 'POWER_ON' } } })
  assert.deepEqual(parseThinqMessage({ pushType: 'DEVICE_PUSH', deviceId: 'ar', pushCode: 'FILTER' }), { kind: 'push', deviceId: 'ar', code: 'FILTER' })
  assert.deepEqual(parseThinqMessage({ pushType: 'DEVICE_UNREGISTERED', deviceId: 'ar' }), { kind: 'changed', deviceId: 'ar' })
  for (const bad of [null, [], { pushType: 'DEVICE_STATUS', deviceId: 'ar' }, { pushType: 'DEVICE_STATUS', deviceId: 'ar', report: {} }, { pushType: 'OUTRO', deviceId: 'ar' }, { pushType: 'DEVICE_STATUS', report: { a: 1 } }]) {
    assert.equal(parseThinqMessage(bad), null)
  }
})

test('relato parcial e fundido por recurso e por unidade de temperatura', () => {
  const merged = mergeReport(initialState(), {
    operation: { airConOperationMode: 'POWER_ON' },
    temperatureInUnits: [{ unit: 'C', targetTemperature: 22 }],
    airQualitySensor: { humidity: 55 },
    __proto__: { poluido: true }
  })
  assert.equal(merged.operation.airConOperationMode, 'POWER_ON')
  assert.deepEqual(merged.airConJobMode, { currentJobMode: 'COOL' })
  assert.deepEqual(merged.temperatureInUnits, [{ unit: 'C', targetTemperature: 22, currentTemperature: 27 }, { unit: 'F', targetTemperature: 75, currentTemperature: 80 }])
  assert.equal(merged.airQualitySensor.humidity, 55)
  assert.equal({}.poluido, undefined)
})

function fakeClient(overrides = {}) {
  const calls = []
  const client = {
    calls,
    clientId: 'cliente-1',
    listDevices: async () => { calls.push('listDevices'); return [{ deviceId: 'ar', deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER', modelName: 'RAC', alias: 'Ar da sala' } }, { deviceId: 'geladeira', deviceInfo: { deviceType: 'DEVICE_REFRIGERATOR' } }] },
    getProfile: async () => profile,
    getState: async () => { calls.push('getState'); return initialState() },
    control: async () => {},
    registerClient: async () => { calls.push('register') },
    getRoute: async () => ({ mqttServer: 'mqtts://abc-ats.iot.us-west-2.amazonaws.com:8883' }),
    issueCertificate: async (csr) => { calls.push('certificate'); assert.ok(csr.length > 100); return { resultCode: '0000', result: { certificatePem: 'CERT', subscriptions: ['app/clients/cliente-1/push', 'app/clients/cliente-1/inbox'] } } },
    subscribeEvents: async (id) => { calls.push(`events:${id}`) },
    subscribeDeviceList: async () => { calls.push('deviceList') },
    ...overrides
  }
  return client
}

function listen() {
  const out = { events: [], statuses: [] }
  out.listener = { event: (event) => out.events.push(event), status: (state, error) => out.statuses.push(error ? `${state}:${error}` : state) }
  return out
}

test('watch emite certificado, guarda no cofre, assina so o ar e aplica relatos parciais', async (t) => {
  const broker = fakeBroker()
  const client = fakeClient()
  let saved = null
  const driver = new ThinqDriver(client, { loadCredentials: () => null, saveCredentials: (value) => { saved = value }, connect: broker.connect })
  const out = listen()
  const handle = await driver.watch(out.listener)
  t.after(() => handle.stop())
  await until(() => out.statuses.includes('live'))
  const mqtt = broker.last()
  assert.equal(mqtt.url, 'mqtts://abc-ats.iot.us-west-2.amazonaws.com:8883')
  assert.equal(mqtt.options.clientId, 'cliente-1')
  assert.equal(mqtt.options.cert, 'CERT')
  assert.match(mqtt.options.key, /BEGIN PRIVATE KEY/)
  assert.equal(mqtt.options.clean, false)
  assert.deepEqual(mqtt.subscribed, ['app/clients/cliente-1/push', 'app/clients/cliente-1/inbox'])
  assert.deepEqual(client.calls.filter((c) => !['getState', 'listDevices'].includes(c)), ['register', 'certificate', 'events:ar', 'deviceList'])
  assert.equal(saved.clientId, 'cliente-1')
  assert.equal(saved.certificatePem, 'CERT')
  assert.deepEqual(out.statuses, ['connecting', 'live'])

  mqtt.deliver('app/clients/cliente-1/push', { pushType: 'DEVICE_STATUS', deviceId: 'ar', report: { operation: { airConOperationMode: 'POWER_ON' } } })
  mqtt.deliver('app/clients/cliente-1/push', { pushType: 'DEVICE_STATUS', deviceId: 'ar', report: { temperatureInUnits: [{ unit: 'C', targetTemperature: 21 }] } })
  const states = out.events.filter((e) => e.type === 'state').map((e) => e.device)
  assert.equal(states.length, 2)
  assert.equal(states[0].state.power, true)
  assert.equal(states[0].state.temperature, 24)
  assert.equal(states[1].state.power, true, 'o segundo relato mantem o que o primeiro trouxe')
  assert.equal(states[1].state.temperature, 21)
  assert.equal(states[1].state.currentTemperature, 27)
  assert.equal(states[1].name, 'Ar da sala')
  assert.equal(states[1].driverId, 'thinq')
})

test('certificado salvo e reaproveitado; assinatura ja existente (1207 ou 4001) conta como sucesso', async (t) => {
  const broker = fakeBroker()
  const client = fakeClient({
    subscribeEvents: async () => { throw Object.assign(new Error('ja'), { code: '1207' }) },
    // Resposta real da nuvem LG para assinatura repetida.
    subscribeDeviceList: async () => { throw Object.assign(new Error('Already Subscirbed Home Push'), { code: '4001' }) }
  })
  const stored = { clientId: 'cliente-1', privateKeyPem: 'KEY', certificatePem: 'SALVO', subscriptions: ['t'] }
  const driver = new ThinqDriver(client, { loadCredentials: (id) => id === 'cliente-1' ? stored : null, saveCredentials: () => assert.fail('nao emite de novo'), connect: broker.connect })
  const out = listen()
  const handle = await driver.watch(out.listener)
  t.after(() => handle.stop())
  await tick(50)
  assert.equal(client.calls.includes('certificate'), false)
  assert.equal(broker.last().options.cert, 'SALVO')
  assert.deepEqual(out.statuses, ['connecting', 'live'])
})

test('certificado recusado antes de qualquer conexao e emitido de novo uma vez', async (t) => {
  const broker = fakeBroker({ autoConnect: false })
  const client = fakeClient()
  const saves = []
  const stored = { clientId: 'cliente-1', privateKeyPem: 'KEY', certificatePem: 'REVOGADO', subscriptions: ['t'] }
  const driver = new ThinqDriver(client, { loadCredentials: () => stored, saveCredentials: (value) => saves.push(value), connect: broker.connect })
  const handle = await driver.watch(listen().listener)
  t.after(() => handle.stop())
  await tick(50)
  broker.last().emit('error', new Error('Connection refused: Not authorized'))
  await until(() => broker.clients.length === 2)
  assert.equal(broker.clients.length, 2)
  assert.equal(broker.clients[1].options.cert, 'CERT')
  assert.equal(saves.length, 1)
})

test('aparelho sem estado conhecido e relido; mudanca na conta pede releitura; token invalido para', async (t) => {
  const broker = fakeBroker()
  const client = fakeClient()
  const driver = new ThinqDriver(client, { connect: broker.connect })
  const out = listen()
  const handle = await driver.watch(out.listener)
  t.after(() => handle.stop())
  await until(() => out.statuses.includes('live'))
  broker.last().deliver('t', { pushType: 'DEVICE_STATUS', deviceId: 'novo', report: { operation: {} } })
  broker.last().deliver('t', { pushType: 'DEVICE_REGISTERED', deviceId: 'novo' })
  assert.deepEqual(out.events, [{ type: 'refresh' }])
  await tick(1700)
  // A releitura do "novo" falha (nao esta na conta) e nao gera evento.
  assert.deepEqual(out.events, [{ type: 'refresh' }])

  let attempts = 0
  const bad = fakeClient({ registerClient: async () => { attempts++; throw Object.assign(new Error('Token invalido'), { code: '1103' }) } })
  const out2 = listen()
  const handle2 = await new ThinqDriver(bad, { connect: fakeBroker().connect }).watch(out2.listener)
  t.after(() => handle2.stop())
  await tick(1500)
  assert.equal(attempts, 1)
  assert.equal(out2.statuses.at(-1), 'unavailable:Token invalido')
})

test('falha de assinatura nao impede a conexao', async (t) => {
  const broker = fakeBroker()
  const client = fakeClient({ subscribeEvents: async () => { throw Object.assign(new Error('instavel'), { code: '2000' }) } })
  const out = listen()
  const handle = await new ThinqDriver(client, { loadCredentials: () => ({ clientId: 'cliente-1', privateKeyPem: 'K', certificatePem: 'C', subscriptions: ['t'] }), connect: broker.connect }).watch(out.listener)
  t.after(() => handle.stop())
  await until(() => out.statuses.includes('live'))
  assert.equal(broker.clients.length, 1)
})

test('getDevice com ficha em cache propaga falha de leitura em vez de dizer offline', async () => {
  let fail = false
  const client = fakeClient({ getState: async () => { if (fail) throw Object.assign(new Error('Limite de chamadas'), { code: '1306' }); return initialState() } })
  const driver = new ThinqDriver(client)
  await driver.listDevices()
  fail = true
  await assert.rejects(driver.getDevice('ar'), /Limite/)
  assert.equal(client.calls.filter((c) => c === 'listDevices').length, 1, 'nao relista a conta')
  const listed = await driver.listDevices()
  assert.equal(listed[0].state.online, false, 'a lista continua tolerante')
})

test('queda de rede nao reemite o certificado salvo', async (t) => {
  const broker = fakeBroker({ autoConnect: false })
  const client = fakeClient()
  const saves = []
  const stored = { clientId: 'cliente-1', privateKeyPem: 'KEY', certificatePem: 'BOM', subscriptions: ['t'] }
  const driver = new ThinqDriver(client, { loadCredentials: () => stored, saveCredentials: (value) => saves.push(value), connect: broker.connect })
  const handle = await driver.watch(listen().listener)
  t.after(() => handle.stop())
  await until(() => broker.clients.length === 1)
  broker.last().emit('error', Object.assign(new Error('connect ECONNREFUSED 52.1.2.3:8883'), { code: 'ECONNREFUSED' }))
  await until(() => broker.clients.length === 2)
  assert.equal(broker.clients[1].options.cert, 'BOM')
  assert.equal(saves.length, 0)
  assert.equal(client.calls.filter((c) => c === 'register').length, 1, 'registro uma vez por sessao')
})

test('LG: leitura que comecou antes de um relato usa a leitura como base e reaplica o relato', async (t) => {
  const broker = fakeBroker()
  let release = null
  let slow = false
  const client = fakeClient({
    getState: async () => {
      if (slow) await new Promise((resolve) => { release = resolve })
      return slow
        ? { ...initialState(), airConJobMode: { currentJobMode: 'HEAT' }, operation: { airConOperationMode: 'POWER_OFF' } }
        : initialState()
    }
  })
  const out = listen()
  const stored = { clientId: 'cliente-1', privateKeyPem: 'K', certificatePem: 'C', subscriptions: ['t'] }
  const driver = new ThinqDriver(client, { loadCredentials: () => stored, connect: broker.connect })
  const handle = await driver.watch(out.listener)
  t.after(() => handle.stop())
  await until(() => out.statuses.includes('live'))
  slow = true
  const reading = driver.getDevice('ar')
  await until(() => release !== null)
  broker.last().deliver('t', { pushType: 'DEVICE_STATUS', deviceId: 'ar', report: { operation: { airConOperationMode: 'POWER_ON' } } })
  release()
  const device = await reading
  assert.equal(device.state.power, true, 'relato mais novo vence')
  assert.equal(device.state.mode, 'HEAT', 'o resto vem da leitura')
})

test('LG: reaplicar relato com lista sem unidade nao duplica', async () => {
  const { mergeReport } = await loadSource('src/main/drivers/thinq/realtime.ts')
  const once = mergeReport({ errors: [{ code: 'E1' }] }, { errors: [{ code: 'E1' }] })
  assert.deepEqual(once.errors, [{ code: 'E1' }])
})
