import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'

const { ThinqClient } = await loadSource('src/main/drivers/thinq/client.ts')

function mockFetch(t, handler) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined }
    calls.push(call)
    const reply = handler(call) ?? { response: {} }
    return new Response(JSON.stringify(reply.body ?? reply), { status: reply.status ?? 200 })
  }
  t.after(() => { globalThis.fetch = original })
  return calls
}

const client = () => new ThinqClient({ token: 'pat', country: 'br', clientId: 'cliente-1' })

test('endpoints do MQTT usam caminhos, corpos e cabecalhos do SDK oficial', async (t) => {
  const calls = mockFetch(t, () => ({ response: { ok: true } }))
  const api = client()
  await api.registerClient()
  await api.getRoute()
  await api.issueCertificate('CSR')
  await api.subscribeEvents('a/b')
  await api.subscribeDeviceList()
  await api.unsubscribeEvents('a/b')
  await api.unsubscribeDeviceList()
  await api.unregisterClient()

  const clientBody = { type: 'MQTT', 'service-code': 'SVC202', 'device-type': '607', allowExist: true }
  assert.deepEqual(calls.map((c) => [c.method, c.url.replace('https://api-aic.lgthinq.com/', ''), c.body]), [
    ['POST', 'client', clientBody],
    ['GET', 'route', undefined],
    ['POST', 'client/certificate', { 'service-code': 'SVC202', csr: 'CSR' }],
    ['POST', 'event/a%2Fb/subscribe', { expire: { unit: 'HOUR', timer: 4464 } }],
    ['POST', 'push/devices', undefined],
    ['DELETE', 'event/a%2Fb/unsubscribe', undefined],
    ['DELETE', 'push/devices', undefined],
    ['DELETE', 'client', clientBody]
  ])
  for (const call of calls) {
    assert.equal(call.headers['x-client-id'], 'cliente-1')
    assert.equal(call.headers.Authorization, 'Bearer pat')
    assert.equal('x-conditional-control' in call.headers, false)
  }
  assert.equal(api.clientId, 'cliente-1')
})

test('erro da LG chega com o codigo para o chamador decidir', async (t) => {
  mockFetch(t, () => ({ status: 400, body: { error: { code: '1207', message: 'Already subscribed push' } } }))
  await assert.rejects(client().subscribeDeviceList(), (error) => error.code === '1207')
})
