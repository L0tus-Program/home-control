import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'
import { fakeBroker, tick } from './fake-mqtt.mjs'

const { MqttLink, MAX_PAYLOAD_BYTES } = await loadSource('src/main/realtime/mqtt-link.ts')

function setup(overrides = {}) {
  const broker = fakeBroker(overrides.broker)
  const log = { statuses: [], messages: [], reconnected: 0, prepares: 0 }
  const link = new MqttLink({
    prepare: async () => { log.prepares++; return { url: 'mqtts://broker.test:8883', options: { clientId: 'c' }, topics: ['a', 'b'], ...overrides.target } },
    message: (topic, payload) => log.messages.push([topic, payload.toString()]),
    status: (state, error) => log.statuses.push(error ? `${state}:${error}` : state),
    reconnected: () => log.reconnected++,
    connect: broker.connect,
    timing: { minBackoffMs: 5, maxBackoffMs: 20, stableMs: 50, subscribeTimeoutMs: 200 },
    ...overrides.options
  })
  return { broker, log, link }
}

test('conecta, assina os topicos, fica ao vivo e entrega mensagens', async () => {
  const { broker, log, link } = setup()
  link.start()
  await tick(10)
  const client = broker.last()
  assert.deepEqual(client.subscribed, ['a', 'b'])
  assert.equal(client.options.reconnectPeriod, 0, 'reconexao e nossa, para renovar credenciais')
  assert.equal(client.options.rejectUnauthorized, true)
  assert.deepEqual(log.statuses, ['connecting', 'live'])
  client.deliver('a', { ok: 1 })
  client.emit('message', 'a', Buffer.alloc(MAX_PAYLOAD_BYTES + 1))
  assert.deepEqual(log.messages, [['a', '{"ok":1}']])
  await link.stop()
  assert.equal(client.ended, true)
})

test('queda reconecta com dados novos e avisa que eventos podem ter se perdido', async () => {
  const { broker, log, link } = setup()
  link.start()
  await tick(10)
  broker.last().emit('close')
  await tick(40)
  assert.equal(broker.clients.length, 2)
  assert.equal(log.prepares, 2)
  assert.equal(log.reconnected, 1)
  assert.equal(log.statuses.at(-1), 'live')
  // Evento atrasado do cliente antigo nao conta.
  broker.clients[0].deliver('a', 'velho')
  assert.deepEqual(log.messages, [])
  await link.stop()
})

test('falhas seguidas viram unavailable, mas continuam tentando', async () => {
  let calls = 0
  const { log, link } = setup({ options: { prepare: async () => { calls++; throw new Error('sem rede') } } })
  link.start()
  await tick(120)
  assert.ok(calls >= 3)
  assert.ok(log.statuses.includes('unavailable:Não consegui manter a atualização em tempo real. Tentando de novo.'), 'erro tecnico nao chega a UI')
  await link.stop()
  const after = calls
  await tick(60)
  assert.equal(calls, after, 'parado nao tenta mais')
})

test('falha fatal para de tentar', async () => {
  let calls = 0
  const { log, link } = setup({ options: { prepare: async () => { calls++; throw Object.assign(new Error('sessao removida'), { code: 'x' }) }, isFatal: () => true } })
  link.start()
  await tick(60)
  assert.equal(calls, 1)
  assert.equal(log.statuses.at(-1), 'unavailable:sessao removida')
  await link.stop()
})

test('renova antes das credenciais vencerem', async () => {
  const { broker, log, link } = setup({ target: { expiresAt: Date.now() + 60_000 + 15 } })
  link.start()
  await tick(80)
  assert.ok(broker.clients.length >= 2)
  assert.equal(broker.clients[0].ended, true)
  assert.ok(log.prepares >= 2)
  await link.stop()
})

test('assinaturas todas recusadas contam como falha; erro tecnico nao chega a UI', async () => {
  const { log, link } = setup({ broker: { refuse: true } })
  link.start()
  await tick(15)
  assert.ok(log.statuses.some((status) => status.startsWith('connecting:O servidor recusou')))
  assert.equal(log.statuses.includes('live'), false)
  assert.equal(log.statuses.some((status) => /Subscribe error/.test(status)), false)
  await link.stop()
})

test('um topico recusado nao derruba os outros', async () => {
  const { broker, log, link } = setup({ broker: { refuse: (topic) => topic === 'a' } })
  link.start()
  await tick(15)
  assert.deepEqual(broker.last().subscribed, ['b'])
  assert.equal(log.statuses.at(-1), 'live')
  assert.equal(broker.clients.length, 1)
  await link.stop()
})

test('broker que aceita e fecha logo nao vira loop: a espera cresce', async () => {
  const { broker, log, link } = setup({ options: { timing: { minBackoffMs: 20, maxBackoffMs: 2000, stableMs: 10_000, subscribeTimeoutMs: 200 } } })
  link.start()
  const close = setInterval(() => { const client = broker.last(); if (client && !client.closedByTest && client.subscribed.length) { client.closedByTest = true; client.emit('close') } }, 2)
  await tick(400)
  clearInterval(close)
  await link.stop()
  // Sem crescer, 20-40 ms dariam ~12 conexoes; com dobra, no maximo umas 5.
  assert.ok(broker.clients.length <= 6, `conexoes: ${broker.clients.length}`)
  assert.ok(log.statuses.includes('unavailable:Conexão de tempo real encerrada.'))
})

test('assinatura sem resposta vira falha', async () => {
  const { broker, log, link } = setup({ options: { timing: { minBackoffMs: 1000, maxBackoffMs: 1000, stableMs: 50, subscribeTimeoutMs: 30 } } })
  const connect = broker.connect
  const hang = (url, options) => { const client = connect(url, options); client.subscribeAsync = () => new Promise(() => {}); return client }
  const stuck = new (link.constructor)({ ...linkOptions(log), connect: hang, timing: { minBackoffMs: 1000, maxBackoffMs: 1000, stableMs: 50, subscribeTimeoutMs: 30 } })
  stuck.start()
  await tick(80)
  assert.ok(log.statuses.some((status) => status.startsWith('connecting:Assinatura de tempo real sem resposta')))
  await stuck.stop()
})

function linkOptions(log) {
  return {
    prepare: async () => ({ url: 'mqtts://broker.test:8883', options: {}, topics: ['a'] }),
    message: () => {},
    status: (state, error) => log.statuses.push(error ? `${state}:${error}` : state),
    reconnected: () => {}
  }
}
