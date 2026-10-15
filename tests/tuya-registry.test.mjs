import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'

test('selecionar Tuya não consulta LG mesmo com ambas as credenciais salvas', async (t) => {
  const { listAllDevices } = await loadSource('src/main/drivers/registry.ts', {
    '../store': `
      export const getToken = () => 'token-lg-salvo'
      export const getCountry = () => 'BR'
      export const getClientId = () => 'client-id-estavel'
      export const getTuyaCredentials = () => ({ accessId: 'id', accessSecret: 'secret' })
      export const getTuyaRegion = () => 'us'
      export const getTuyaSession = () => null
      export const getThinqMqttCredentials = () => null
      export const setThinqMqttCredentials = () => {}
      export const setTuyaSession = () => { throw new Error('teste Cloud não deve gravar sessão QR') }
    `
  })
  const requests = []
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async (url) => {
    requests.push(url)
    assert.ok(url.startsWith('https://openapi.tuyaus.com/'), 'apenas o endpoint Tuya deve ser consultado')
    let result
    if (url.includes('/token?')) {
      result = { access_token: 'sessao', expire_time: 7200 }
    } else if (url.includes('/associated-users/devices?')) {
      result = {
        devices: [{ id: 'luz', category: 'dj', name: 'Sala', online: true, status: [{ code: 'switch_led', value: true }] }],
        has_more: false
      }
    } else if (url.endsWith('/functions')) {
      result = { functions: [{ code: 'switch_led', type: 'Boolean', values: '{}' }] }
    } else {
      throw new Error(`Consulta inesperada: ${url}`)
    }
    return new Response(JSON.stringify({ success: true, result }))
  }
  const result = await listAllDevices('tuya')
  assert.equal(result.devices.length, 1)
  assert.equal(result.devices[0].driverId, 'tuya')
  assert.deepEqual(result.statuses, [
    { id: 'thinq', label: 'LG ThinQ', configured: true },
    { id: 'tuya', label: 'Tuya', configured: true }
  ])
  assert.equal(requests.length, 3)
  await assert.rejects(listAllDevices('inexistente'), /desconhecida/i)
  assert.equal(requests.length, 3)
})
