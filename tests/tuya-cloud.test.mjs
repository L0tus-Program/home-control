import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { loadSource } from './load-source.mjs'

const { TuyaCloud } = await loadSource('src/main/drivers/tuya/cloud.ts')
const config = { accessId: 'access-id', accessSecret: 'secret', region: 'us' }
const token = (value = 'token-1') => ({ access_token: value, expire_time: 7200 })
const success = (result) => new Response(JSON.stringify({ success: true, result }))

function mockFetch(t, handler) {
  const original = globalThis.fetch
  globalThis.fetch = handler
  t.after(() => { globalThis.fetch = original })
}

test('assina token e comando com HMAC oficial, incluindo corpo e access token', async (t) => {
  const originalNow = Date.now
  Date.now = () => 1700000000000
  t.after(() => { Date.now = originalNow })
  const requests = []
  mockFetch(t, async (url, init) => {
    requests.push({ url, ...init })
    return success(requests.length === 1 ? token() : true)
  })
  const cloud = new TuyaCloud(config)
  await cloud.sendCommands('lampada', [{ code: 'switch_led', value: true }])
  assert.equal(requests[0].url, 'https://openapi.tuyaus.com/v1.0/token?grant_type=1')
  assert.equal(requests[0].headers.sign, '9CDF7499FBA461C4EE5C37D016BE1E73701A71498CED3EA37EA88F15AC2311FF')
  assert.equal(requests[0].headers.access_token, undefined)
  const command = requests[1]
  assert.equal(command.body, '{"commands":[{"code":"switch_led","value":true}]}')
  const bodyHash = createHash('sha256').update(command.body).digest('hex')
  const message = `access-idtoken-11700000000000POST\n${bodyHash}\n\n/v1.0/devices/lampada/commands`
  assert.equal(command.headers.sign, createHmac('sha256', 'secret').update(message).digest('hex').toUpperCase())
  assert.equal(command.headers.access_token, 'token-1')
  assert.equal(command.headers['Content-Type'], 'application/json')
})

test('paginação mantém todos os dispositivos e assina a query ordenada', async (t) => {
  const urls = []
  mockFetch(t, async (url) => {
    urls.push(url)
    if (url.includes('/token?')) return success(token())
    if (urls.length === 2) return success({ devices: [{ id: 'a' }], has_more: true, last_row_key: 'linha +&' })
    return success({ devices: [{ id: 'b' }], has_more: false })
  })
  assert.deepEqual(await new TuyaCloud(config).listDevices(), [{ id: 'a' }, { id: 'b' }])
  assert.equal(urls[1], 'https://openapi.tuyaus.com/v1.0/iot-01/associated-users/devices?size=20')
  const query = urls[2].slice(urls[2].indexOf('?') + 1)
  assert.equal(new URLSearchParams(query).get('last_row_key'), 'linha +&')
  assert.deepEqual([...new URLSearchParams(query).keys()], ['last_row_key', 'size'])
})

test('chamadas concorrentes compartilham a obtenção do token', async (t) => {
  let tokens = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  mockFetch(t, async (url) => {
    if (url.includes('/token?')) {
      tokens++
      await gate
      return success(token())
    }
    return success([])
  })
  const cloud = new TuyaCloud(config)
  const first = cloud.getStatus('a')
  const second = cloud.getStatus('b')
  release()
  await Promise.all([first, second])
  assert.equal(tokens, 1)
})

for (const code of [1010, 1011, 1012]) {
  test(`renova token inválido (${code}) e repete a operação uma vez`, async (t) => {
    let tokens = 0
    let attempts = 0
    mockFetch(t, async (url, init) => {
      if (url.includes('/token?')) return success(token(`token-${++tokens}`))
      attempts++
      if (attempts === 1) return new Response(JSON.stringify({ success: false, code, msg: 'token invalid' }))
      assert.equal(init.headers.access_token, 'token-2')
      return success([{ code: 'switch_led', value: true }])
    })
    assert.deepEqual(await new TuyaCloud(config).getStatus('a'), [{ code: 'switch_led', value: true }])
    assert.equal(tokens, 2)
    assert.equal(attempts, 2)
  })
}

test('não repete indefinidamente uma autorização rejeitada', async (t) => {
  let attempts = 0
  mockFetch(t, async (url) => {
    if (url.includes('/token?')) return success(token())
    attempts++
    return new Response(JSON.stringify({ success: false, code: 1010, msg: 'invalid' }))
  })
  await assert.rejects(new TuyaCloud(config).getStatus('a'))
  assert.equal(attempts, 2)
})

test('comando recusado pela nuvem não retorna sucesso para a interface', async (t) => {
  mockFetch(t, async (url) => success(url.includes('/token?') ? token() : false))
  await assert.rejects(new TuyaCloud(config).sendCommands('a', [{ code: 'switch_led', value: true }]))
})

test('falha HTTP mesmo que o corpo declare success', async (t) => {
  mockFetch(t, async () => new Response(JSON.stringify({ success: true, result: token() }), { status: 503 }))
  await assert.rejects(new TuyaCloud(config).verify())
})

test('resposta inválida e erro de rede chegam como erro legível', async (t) => {
  mockFetch(t, async () => new Response('<html>falha</html>'))
  await assert.rejects(new TuyaCloud(config).verify(), /Tuya|resposta/i)
  globalThis.fetch = async () => { throw new Error('sem conexão') }
  await assert.rejects(new TuyaCloud(config).verify(), /conexão/i)
})

test('consulta um aparelho diretamente com identificador escapado', async (t) => {
  const urls = []
  mockFetch(t, async (url) => {
    urls.push(url)
    return success(url.includes('/token?') ? token() : { id: 'a/b', online: false })
  })
  assert.deepEqual(await new TuyaCloud(config).getDevice('a/b'), { id: 'a/b', online: false })
  assert.equal(urls[1], 'https://openapi.tuyaus.com/v1.0/devices/a%2Fb')
})

test('paginação duplicada não repete aparelhos e cursor cíclico falha', async (t) => {
  let pages = 0
  mockFetch(t, async (url) => {
    if (url.includes('/token?')) return success(token())
    pages++
    return success({
      devices: [{ id: 'a', name: pages === 1 ? 'antigo' : 'atual' }],
      has_more: pages === 1,
      last_row_key: 'cursor'
    })
  })
  assert.deepEqual(await new TuyaCloud(config).listDevices(), [{ id: 'a', name: 'atual' }])
  pages = 0
  globalThis.fetch = async (url) => {
    if (url.includes('/token?')) return success(token())
    pages++
    assert.ok(pages < 4, 'paginação deve interromper cursor repetido')
    return success({ devices: [], has_more: true, last_row_key: 'repetido' })
  }
  await assert.rejects(new TuyaCloud(config).listDevices(), /lista|paginação/i)
  assert.equal(pages, 2)
})

test('renova preventivamente token próximo do vencimento', async (t) => {
  const originalNow = Date.now
  let now = 1700000000000
  Date.now = () => now
  t.after(() => { Date.now = originalNow })
  let tokens = 0
  mockFetch(t, async (url) => {
    if (url.includes('/token?')) return success(token(`token-${++tokens}`))
    return success([])
  })
  const cloud = new TuyaCloud(config)
  await cloud.getStatus('a')
  now += 60000
  await cloud.getStatus('a')
  assert.equal(tokens, 1)
  now += 7200000
  await cloud.getStatus('a')
  assert.equal(tokens, 2)
})

test('não reenvia comando após erro de rede ambíguo', async (t) => {
  let attempts = 0
  mockFetch(t, async (url) => {
    if (url.includes('/token?')) return success(token())
    attempts++
    throw new Error('resposta perdida depois de transmitir comando')
  })
  await assert.rejects(new TuyaCloud(config).sendCommands('a', [{ code: 'switch_led', value: false }]))
  assert.equal(attempts, 1)
})

test('token malformado falha sem enviar requisições autenticadas', async (t) => {
  let attempts = 0
  mockFetch(t, async () => { attempts++; return success({ access_token: '', expire_time: 0 }) })
  await assert.rejects(new TuyaCloud(config).getStatus('a'), /token/i)
  assert.equal(attempts, 1)
})
