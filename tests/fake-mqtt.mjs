import { EventEmitter } from 'node:events'

/** Broker falso: cada `connect` cria um cliente que o teste controla. */
export function fakeBroker({ autoConnect = true, refuse = false } = {}) {
  const broker = { clients: [], connects: [] }
  broker.connect = (url, options) => {
    const client = new EventEmitter()
    client.url = url
    client.options = options
    client.subscribed = []
    client.ended = false
    // Como o mqtt.js 5: SUBACK 0x80 rejeita com code 128.
    const refused = typeof refuse === 'function' ? refuse : () => refuse
    client.subscribeAsync = async (topic, opts) => {
      if (refused(topic)) throw Object.assign(new Error('Subscribe error: Unspecified error'), { code: 128 })
      client.subscribed.push(topic)
      return [{ topic, qos: opts.qos }]
    }
    client.end = () => { client.ended = true; return client }
    client.endAsync = async () => { client.ended = true }
    client.deliver = (topic, payload) => client.emit('message', topic, Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)))
    broker.clients.push(client)
    broker.connects.push({ url, options })
    if (autoConnect) setImmediate(() => client.emit('connect'))
    return client
  }
  broker.last = () => broker.clients.at(-1)
  return broker
}

export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

/** Espera uma condicao (geracao de chave RSA leva tempo variavel). */
export async function until(check, ms = 5000) {
  const deadline = Date.now() + ms
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condicao nao aconteceu a tempo')
    await tick(10)
  }
  await tick(10)
}
