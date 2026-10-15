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
    client.subscribeAsync = async (topic, opts) => {
      client.subscribed.push(topic)
      return [{ topic, qos: refuse ? 128 : opts.qos }]
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
