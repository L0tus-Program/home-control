import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, createHmac, createCipheriv, createDecipheriv } from 'node:crypto'
import { loadSource } from './load-source.mjs'

const { TuyaSharing, TUYA_SHARING_CLIENT_ID, assertTuyaSharingEndpoint } = await loadSource('src/main/drivers/tuya/sharing.ts')
const session = () => ({
  userCode: 'usuario', endpoint: 'https://apigw.tuyaus.com', terminalId: 'terminal',
  token: { accessToken: 'access-1', refreshToken: 'refresh-1', uid: 'uid', expiresAt: Date.now() + 7_200_000 }
})
const lamp = (id = 'lamp') => ({ id, name: 'Lâmpada', category: 'dj', online: true, status: [{ code: 'switch_led', value: true }] })

function codec(headers, refreshToken) {
  const hash = createHash('md5').update(headers['X-requestId'] + refreshToken).digest('hex')
  const secret = createHmac('sha256', headers['X-requestId']).update(hash).digest('hex').substring(0, 16)
  return {
    hash,
    encode(value) {
      const iv = Buffer.from('ABCDEFGHJKLM')
      const cipher = createCipheriv('aes-128-gcm', Buffer.from(secret), iv)
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()])
      // O SDK concatena base64(nonce) + base64(ciphertext). 12 bytes não geram padding.
      return iv.toString('base64') + ciphertext.toString('base64')
    },
    decode(value) {
      const bytes = Buffer.from(value, 'base64')
      const decipher = createDecipheriv('aes-128-gcm', Buffer.from(secret), bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(-16))
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString())
    }
  }
}

function mockApi(t, handler) {
  const original = globalThis.fetch
  let refreshToken = 'refresh-1'
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(url)
    const crypto = codec(init.headers, refreshToken)
    const queryCipher = parsed.searchParams.get('encdata') ?? ''
    const bodyCipher = init.body ? JSON.parse(init.body).encdata : ''
    const signed = ['X-appKey', 'X-requestId', 'X-sid', 'X-time', 'X-token']
      .filter((header) => init.headers[header]).map((header) => `${header}=${init.headers[header]}`).join('||') + queryCipher + bodyCipher
    assert.equal(init.headers['X-sign'], createHmac('sha256', crypto.hash).update(signed).digest('hex'))
    assert.equal(init.headers['X-appKey'], TUYA_SHARING_CLIENT_ID)
    assert.equal(init.redirect, 'error')
    assert.ok(init.signal instanceof AbortSignal)
    const query = queryCipher ? crypto.decode(queryCipher) : undefined
    const body = bodyCipher ? crypto.decode(bodyCipher) : undefined
    const result = await handler({ path: parsed.pathname, query, body, init, url })
    if (result instanceof Response) return result
    const response = new Response(JSON.stringify({ success: true, result: crypto.encode(result), t: Date.now() }))
    if (parsed.pathname.startsWith('/v1.0/m/token/') && result?.refreshToken) refreshToken = result.refreshToken
    return response
  }
  t.after(() => { globalThis.fetch = original })
}

test('consulta casas e aparelhos pelo protocolo criptografado e remove dados privados', async (t) => {
  const paths = []
  mockApi(t, ({ path, query }) => {
    paths.push(path)
    if (path.endsWith('/homes')) return [{ ownerId: 12 }, { ownerId: '13' }, { ownerId: 12 }]
    assert.equal(path, '/v1.0/m/life/ha/home/devices')
    assert.ok(['12', '13'].includes(query.homeId))
    return [{ ...lamp(), local_key: 'chave-privada', name: query.homeId }]
  })
  assert.deepEqual(await new TuyaSharing(session(), () => {}).listDevices(), [{ ...lamp(), name: '13' }])
  assert.equal(paths.length, 3)
})

test('consulta estado, especificação e envia comandos sem expor conteúdo no corpo HTTP', async (t) => {
  const commands = [{ code: 'switch_led', value: false }]
  mockApi(t, ({ path, query, body, init }) => {
    if (path.endsWith('/detail')) {
      assert.deepEqual(query, { devIds: 'a/b' })
      return [lamp('a/b')]
    }
    if (path.endsWith('/specifications')) {
      assert.equal(path, '/v1.1/m/life/a%2Fb/specifications')
      return { functions: [{ code: 'bright_value_v2', type: 'Integer', values: { min: 10, max: 1000 } }] }
    }
    assert.equal(path, '/v1.1/m/thing/a%2Fb/commands')
    assert.equal(init.method, 'POST')
    assert.deepEqual(body, { commands })
    assert.equal(init.body.includes('switch_led'), false)
    return true
  })
  const client = new TuyaSharing(session(), () => {})
  assert.deepEqual(await client.getStatus('a/b'), lamp().status)
  assert.deepEqual(await client.getFunctions('a/b'), { functions: [{ code: 'bright_value_v2', type: 'Integer', values: '{"min":10,"max":1000}' }] })
  await client.sendCommands('a/b', commands)
})

test('renova sessão uma vez nas consultas concorrentes e persiste antes das requisições', async (t) => {
  const config = session()
  config.token.expiresAt = Date.now() + 1000
  let refreshes = 0
  let saved = false
  let newSession
  mockApi(t, ({ path, init }) => {
    if (path.includes('/m/token/')) {
      refreshes++
      assert.equal(init.headers['X-token'], 'access-1')
      return { accessToken: 'access-2', refreshToken: 'refresh-2', uid: 'uid', expireTime: 7200 }
    }
    assert.equal(saved, true)
    assert.equal(init.headers['X-token'], 'access-2')
    return [lamp()]
  })
  const client = new TuyaSharing(config, async (next) => {
    await Promise.resolve()
    saved = true
    newSession = structuredClone(next)
    next.token.accessToken = 'alterado-pelo-callback'
  })
  await Promise.all([client.getDevice('lamp'), client.getStatus('lamp')])
  assert.equal(refreshes, 1)
  assert.equal(config.token.accessToken, 'access-1')
  assert.equal(newSession.token.accessToken, 'access-2')
  assert.ok(newSession.token.expiresAt > Date.now() + 7_000_000)
})

test('falha de persistência interrompe renovação antes de qualquer controle de aparelho', async (t) => {
  const config = session()
  config.token.expiresAt = 0
  let requests = 0
  mockApi(t, ({ path }) => {
    requests++
    assert.ok(path.includes('/m/token/'))
    return { accessToken: 'access-2', refreshToken: 'refresh-2', uid: 'uid', expireTime: 7200 }
  })
  await assert.rejects(new TuyaSharing(config, () => { throw new Error('disco indisponível') }).getDevice('lamp'), /disco indisponível/)
  assert.equal(requests, 1)
})

test('sessão não muda quando o objeto recebido pelo construtor é alterado', async (t) => {
  const config = session()
  mockApi(t, ({ init }) => {
    assert.equal(init.headers['X-token'], 'access-1')
    return []
  })
  const client = new TuyaSharing(config, () => {})
  config.token.accessToken = 'alterado'
  config.token.refreshToken = 'alterado'
  config.endpoint = 'https://example.org'
  assert.deepEqual(await client.listDevices(), [])
})

test('rejeição explícita de autenticação renova e repete somente uma vez', async (t) => {
  let queries = 0
  let refreshes = 0
  mockApi(t, ({ path }) => {
    if (path.includes('/m/token/')) {
      refreshes++
      return { accessToken: 'access-2', refreshToken: 'refresh-2', uid: 'uid', expireTime: 7200 }
    }
    queries++
    return new Response(JSON.stringify({ success: false, code: 1010, msg: 'token invalid' }))
  })
  await assert.rejects(new TuyaSharing(session(), () => {}).getDevice('lamp'), /QR Code/)
  assert.equal(queries, 2)
  assert.equal(refreshes, 1)
})

test('não oculta falha na renovação nem envia comandos com sessão expirada', async (t) => {
  const config = session()
  config.token.expiresAt = 0
  let calls = 0
  mockApi(t, ({ path }) => {
    calls++
    assert.ok(path.includes('/m/token/'))
    return new Response(JSON.stringify({ success: false, code: 1010 }))
  })
  await assert.rejects(new TuyaSharing(config, () => {}).sendCommands('lamp', []), /QR Code/)
  assert.equal(calls, 1)
})

test('não reenvia comandos após falhas de rede ou respostas adulteradas', async (t) => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  for (const mode of ['rede', 'criptografia', 'http', 'json', 'recusa']) {
    let attempts = 0
    globalThis.fetch = async () => {
      attempts++
      if (mode === 'rede') throw new Error('conexão interrompida após comando')
      if (mode === 'criptografia') return new Response(JSON.stringify({ success: true, result: Buffer.alloc(48).toString('base64') }))
      if (mode === 'http') return new Response(JSON.stringify({ success: true }), { status: 503 })
      if (mode === 'json') return new Response('<html>falha</html>')
      return new Response(JSON.stringify({ success: false, code: 'unauthorized', msg: 'access-1 refresh-1' }))
    }
    await assert.rejects(new TuyaSharing(session(), () => {}).sendCommands('lamp', []), (error) => {
      assert.equal(error.message.includes('access-1'), false)
      assert.equal(error.message.includes('refresh-1'), false)
      return true
    })
    assert.equal(attempts, 1)
  }
})

test('comando aceita confirmações vazias do SDK mas rejeita resultado false', async (t) => {
  let result = true
  mockApi(t, () => result)
  const client = new TuyaSharing(session(), () => {})
  for (const accepted of [true, null, '', 'ok']) {
    result = accepted
    await client.sendCommands('lamp', [])
  }
  result = false
  await assert.rejects(client.sendCommands('lamp', []), /não aceitou/)
  for (const raw of [null, '', undefined]) {
    result = new Response(JSON.stringify({ success: true, result: raw }))
    await client.sendCommands('lamp', [])
  }
  result = new Response(JSON.stringify({ success: true, result: false }))
  await assert.rejects(client.sendCommands('lamp', []), /não aceitou/)
})

test('respostas incompletas de casas, aparelhos, especificações e token falham com mensagem legível', async (t) => {
  let result
  mockApi(t, () => result)
  const client = new TuyaSharing(session(), () => {})
  result = {}
  await assert.rejects(client.listDevices(), /casas/)
  result = [{ id: 42 }]
  await assert.rejects(client.listDevices(), /casa inválida/)
  result = [{ id: 'lamp' }]
  await assert.rejects(client.getDevice('lamp'), /incompleto/)
  result = [{ ...lamp(), status: [{ code: 'switch_led' }] }]
  await assert.rejects(client.getDevice('lamp'), /Estado inválido/)
  result = []
  await assert.rejects(client.getDevice('lamp'), /não está mais disponível/)
  result = { functions: [{ code: 'switch_led' }] }
  await assert.rejects(client.getFunctions('lamp'), /incompleto/)
  const expired = session()
  expired.token.expiresAt = 0
  result = { accessToken: '', refreshToken: '', expireTime: 0 }
  await assert.rejects(new TuyaSharing(expired, () => {}).listDevices(), /renovou/)
})

test('aceita somente origens oficiais e impede credenciais, caminhos, portas e destinos arbitrários', () => {
  assert.equal(assertTuyaSharingEndpoint('https://apigw.tuyaus.com/'), 'https://apigw.tuyaus.com')
  assert.equal(assertTuyaSharingEndpoint('https://openapi.tuyaeu.com'), 'https://openapi.tuyaeu.com')
  for (const endpoint of [undefined, '', 'http://apigw.tuyaus.com', 'https://apigw.tuyaus.com.evil.test', 'https://evil.test', 'https://user:secret@apigw.tuyaus.com', 'https://apigw.tuyaus.com/path', 'https://apigw.tuyaus.com?x=1', 'https://apigw.tuyaus.com#x', 'https://apigw.tuyaus.com:8443']) {
    assert.throws(() => new TuyaSharing({ ...session(), endpoint }, () => {}), /endereço/)
  }
})

test('guarda só a tradução dpId → código dos aparelhos com controle local, nunca a chave local', async (t) => {
  mockApi(t, ({ path }) => {
    if (path.endsWith('/homes')) return [{ ownerId: 12 }]
    return [{
      ...lamp(), local_key: 'chave-privada', support_local: true,
      local_strategy: {
        20: { status_code: 'switch_led', value_convert: 'default', config_item: { valueType: 'Boolean', pid: 'x' } },
        x: { status_code: 'invalido' },
        22: { value_convert: 'default' }
      }
    }, { ...lamp('sem-local'), support_local: false, local_strategy: { 20: { status_code: 'switch_led' } } }]
  })
  const [local, remote] = await new TuyaSharing(session(), () => {}).listDevices()
  assert.deepEqual(local.local, { dps: { 20: { code: 'switch_led', convert: 'default', valueType: 'Boolean' } } })
  assert.equal(JSON.stringify(local).includes('chave-privada'), false)
  assert.equal('local' in remote, false)
})

test('lista as casas pelo ownerId sem repetir', async (t) => {
  mockApi(t, () => [{ ownerId: 12 }, { ownerId: '13' }, { ownerId: 12 }])
  assert.deepEqual(await new TuyaSharing(session(), () => {}).listHomeIds(), ['12', '13'])
})

test('busca a configuração do MQTT com linkId próprio e valida os campos', async (t) => {
  const config = {
    url: 'ssl://m1.tuyaus.com:8883', clientId: 'cliente', username: 'usuario', password: 'senha', expireTime: 7200,
    topic: { ownerId: { sub: 'cloud/token/in/{ownerId}' }, devId: { sub: 'cloud/token/in/{devId}' } }
  }
  let answer = config
  mockApi(t, ({ path, init, body }) => {
    assert.equal(path, '/v1.0/m/life/ha/access/config')
    assert.equal(init.method, 'POST')
    assert.match(body.linkId, /^home-control\.[0-9a-f-]{36}$/)
    return answer
  })
  const client = new TuyaSharing(session(), () => {})
  assert.deepEqual(await client.getMqttConfig(), {
    url: config.url, clientId: 'cliente', username: 'usuario', password: 'senha', expireTime: 7200,
    ownerTopic: 'cloud/token/in/{ownerId}', deviceTopic: 'cloud/token/in/{devId}'
  })
  for (const broken of [{ ...config, password: '' }, { ...config, expireTime: 30 }, { ...config, topic: { ownerId: { sub: 'sem-marcador' }, devId: config.topic.devId } }]) {
    answer = broken
    await assert.rejects(client.getMqttConfig(), /tempo real/)
  }
})
