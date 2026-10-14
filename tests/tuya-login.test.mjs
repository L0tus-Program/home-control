import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'

const ok = (result) => new Response(JSON.stringify({ success: true, result }))
const rejected = (code, msg) => new Response(JSON.stringify({ success: false, code, msg }))
const authorization = {
  endpoint: 'https://apigw.tuyaus.com', terminal_id: 'terminal', uid: 'usuario',
  access_token: 'access-privado', refresh_token: 'refresh-privado', expire_time: 7200
}
const settings = { thinq: { country: 'BR', hasToken: false }, tuya: { region: 'us', hasCredentials: true, connection: 'qr', userCode: '12345678' } }

async function fixture(t, response = () => ok(authorization)) {
  const context = { qrPayloads: [], requests: [], sessions: [] }
  globalThis.__tuyaLoginTest = context
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; delete globalThis.__tuyaLoginTest })
  globalThis.fetch = async (url, init) => {
    context.requests.push({ url, ...init })
    return init.method === 'POST' ? ok({ qrcode: 'qr-token-privado/123' }) : response(url, init)
  }
  const { TuyaLogin } = await loadSource('src/main/drivers/tuya/login.ts', {
    qrcode: `
      const context = globalThis.__tuyaLoginTest
      export default { toDataURL: async (payload) => {
        context.qrPayloads.push(payload)
        return 'data:image/png;base64,cXItZml4dHVyZQ=='
      } }
    `
  })
  const login = new TuyaLogin((session) => { context.sessions.push(session); return settings })
  return { login, context }
}

test('gera QR oficial por código da conta e expõe apenas identificador opaco e imagem', async (t) => {
  const { login, context } = await fixture(t)
  const qr = await login.start(' 12345678 ')
  const request = context.requests[0]
  const url = new URL(request.url)
  assert.equal(request.method, 'POST')
  assert.equal(url.origin, 'https://apigw.iotbing.com')
  assert.equal(url.pathname, '/v1.0/m/life/home-assistant/qrcode/tokens')
  assert.equal(url.searchParams.get('clientid'), 'HA_3y9q4ak7g4ephrvke')
  assert.equal(url.searchParams.get('schema'), 'haauthorize')
  assert.equal(url.searchParams.get('usercode'), '12345678')
  assert.equal(request.redirect, 'error')
  assert.deepEqual(context.qrPayloads, ['tuyaSmart--qrLogin?token=qr-token-privado/123'])
  assert.match(qr.requestId, /^[\da-f-]{36}$/i)
  assert.match(qr.qrDataUrl, /^data:image\/png;base64,/)
  assert.deepEqual(Object.keys(qr).sort(), ['expiresAt', 'qrDataUrl', 'requestId'])
  assert.ok(!JSON.stringify(qr).includes('qr-token-privado'))
  assert.ok(qr.expiresAt > Date.now())
  login.cancel()
})

test('autoriza usando envelope SDK e mantém tokens somente no callback interno', async (t) => {
  const { login, context } = await fixture(t)
  const qr = await login.start('12345678')
  const result = await login.check(qr.requestId)
  assert.deepEqual(result, { status: 'connected', settings })
  assert.equal(context.sessions.length, 1)
  const session = context.sessions[0]
  assert.equal(session.userCode, '12345678')
  assert.equal(session.terminalId, 'terminal')
  assert.equal(session.token.accessToken, 'access-privado')
  assert.equal(session.token.refreshToken, 'refresh-privado')
  assert.equal(session.token.uid, 'usuario')
  assert.ok(session.token.expiresAt > Date.now() + 7100000)
  assert.ok(!JSON.stringify(result).includes('privado'))
  assert.ok(context.requests[1].url.includes('/tokens/qr-token-privado%2F123?'))
  assert.deepEqual(await login.check(qr.requestId), { status: 'expired' })
})

test('entrada inválida falha antes de acessar nuvem e informa onde achar código', async (t) => {
  const { login, context } = await fixture(t)
  for (const input of ['', '12', '1234&secret=x', null]) {
    await assert.rejects(login.start(input), /Código de Usuário|Conta e segurança/i)
  }
  assert.equal(context.requests.length, 0)
})

test('rejeição do código da conta não gera QR', async (t) => {
  const { login, context } = await fixture(t)
  globalThis.fetch = async () => rejected('USERCODE_INCORRECT', 'wrong user code')
  await assert.rejects(login.start('12345678'), /Código de Usuário não encontrado/i)
  assert.equal(context.qrPayloads.length, 0)
})

test('QR sem token e respostas HTTP/JSON inválidas falham claramente', async (t) => {
  const { login } = await fixture(t)
  for (const response of [
    () => ok({}),
    () => new Response('html indisponível'),
    () => new Response(JSON.stringify({ success: true, result: { qrcode: 'token' } }), { status: 503 })
  ]) {
    globalThis.fetch = async () => response()
    await assert.rejects(login.start('12345678'))
  }
})

test('somente mensagens reconhecidas ficam aguardando; erro desconhecido não é waiting', async (t) => {
  let current = () => rejected('PENDING', 'waiting for scan')
  const { login, context } = await fixture(t, () => current())
  const qr = await login.start('12345678')
  assert.deepEqual(await login.check(qr.requestId), { status: 'waiting' })
  current = () => rejected(42, 'oops')
  await assert.rejects(login.check(qr.requestId))
  current = () => rejected('DENIED', 'access denied by user')
  await assert.rejects(login.check(qr.requestId), /recusada/i)
  assert.equal(context.sessions.length, 0)
})

test('expiração retornada pelo servidor pede renovar o QR', async (t) => {
  const { login, context } = await fixture(t, () => rejected('QRCODE_EXPIRED', 'QR expired'))
  const qr = await login.start('12345678')
  assert.deepEqual(await login.check(qr.requestId), { status: 'expired' })
  assert.deepEqual(await login.check(qr.requestId), { status: 'expired' })
  assert.equal(context.requests.length, 2)
})

test('recusa explícita não vira espera mesmo quando mensagem diz não autorizado', async (t) => {
  const { login } = await fixture(t, () => rejected('AUTH_DENIED', 'user not authorized'))
  const qr = await login.start('12345678')
  await assert.rejects(login.check(qr.requestId), /recusada|autorização/i)
})

test('prazo local e identificador desconhecido não consultam autorização', async (t) => {
  const { login, context } = await fixture(t)
  const qr = await login.start('12345678')
  assert.deepEqual(await login.check('outro-id'), { status: 'expired' })
  const originalNow = Date.now
  Date.now = () => qr.expiresAt + 1
  t.after(() => { Date.now = originalNow })
  assert.deepEqual(await login.check(qr.requestId), { status: 'expired' })
  assert.equal(context.requests.length, 1)
})

test('checks concorrentes compartilham uma consulta', async (t) => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { login, context } = await fixture(t, async () => { await gate; return rejected('PENDING', 'pending') })
  const qr = await login.start('12345678')
  const first = login.check(qr.requestId)
  const second = login.check(qr.requestId)
  release()
  assert.deepEqual(await Promise.all([first, second]), [{ status: 'waiting' }, { status: 'waiting' }])
  assert.equal(context.requests.length, 2)
  login.cancel()
})

test('cancelar durante confirmação impede persistir autorização atrasada', async (t) => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { login, context } = await fixture(t, async () => { await gate; return ok(authorization) })
  const qr = await login.start('12345678')
  const check = login.check(qr.requestId)
  login.cancel(qr.requestId)
  release()
  assert.deepEqual(await check, { status: 'expired' })
  assert.equal(context.sessions.length, 0)
})

test('novo QR invalida confirmação anterior e cancelamento antigo não cancela o novo', async (t) => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { login, context } = await fixture(t, async () => { await gate; return ok(authorization) })
  const first = await login.start('12345678')
  const check = login.check(first.requestId)
  const second = await login.start('87654321')
  assert.notEqual(first.requestId, second.requestId)
  login.cancel(first.requestId)
  release()
  assert.deepEqual(await check, { status: 'expired' })
  assert.equal((await login.check(second.requestId)).status, 'connected')
  assert.equal(context.sessions.length, 1)
  assert.equal(context.sessions[0].userCode, '87654321')
})

test('endereço de sessão fora da Tuya e tokens incompletos nunca são persistidos', async (t) => {
  let response = authorization
  const { login, context } = await fixture(t, () => ok(response))
  for (const invalid of [
    { ...authorization, endpoint: 'https://servidor-invalido.example' },
    { ...authorization, access_token: '' },
    { ...authorization, refresh_token: '' },
    { ...authorization, expire_time: 0 }
  ]) {
    response = invalid
    const qr = await login.start('12345678')
    await assert.rejects(login.check(qr.requestId))
  }
  assert.equal(context.sessions.length, 0)
  login.cancel()
})
