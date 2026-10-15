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
    backoff: { min: 5, max: 20 },
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
  assert.ok(log.statuses.includes('unavailable:sem rede'))
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

test('assinaturas todas recusadas contam como falha', async () => {
  const { log, link } = setup({ broker: { refuse: true } })
  link.start()
  await tick(15)
  assert.ok(log.statuses.some((status) => status.startsWith('connecting:O servidor recusou')))
  assert.equal(log.statuses.includes('live'), false)
  await link.stop()
})
