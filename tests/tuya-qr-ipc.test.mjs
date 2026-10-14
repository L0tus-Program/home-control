import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSource } from './load-source.mjs'

const success = (result) => new Response(JSON.stringify({ success: true, result }))
const authorization = {
  endpoint: 'https://apigw.tuyaus.com', terminal_id: 'terminal', uid: 'usuario',
  access_token: 'token-acesso-privado', refresh_token: 'token-renovacao-privado', expire_time: 7200
}

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'home-control-qr-ipc-'))
  const context = { directory, handlers: new Map(), available: true, invalidations: 0, requests: [] }
  globalThis.__tuyaQrIpc = context
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
    delete globalThis.__tuyaQrIpc
    rmSync(directory, { recursive: true, force: true })
  })
  globalThis.fetch = async (url, init) => {
    context.requests.push({ url, ...init })
    if (url.includes('/home-assistant/qrcode/tokens')) {
      return success(init.method === 'POST' ? { qrcode: 'qr-token' } : authorization)
    }
    if (url.includes('/token?')) return success({ access_token: 'sessao-cloud', expire_time: 7200 })
    if (url.includes('/associated-users/devices?')) return success({ devices: [], has_more: false })
    throw new Error(`Consulta inesperada: ${url}`)
  }
  const { registerIpc } = await loadSource('src/main/ipc.ts', {
    electron: `
      const context = globalThis.__tuyaQrIpc
      export const app = { getPath: () => context.directory }
      export const safeStorage = {
        isEncryptionAvailable: () => context.available,
        encryptString: (value) => Buffer.from([...value].reverse().join('')),
        decryptString: (value) => [...value.toString()].reverse().join('')
      }
      export const ipcMain = { handle: (channel, handler) => context.handlers.set(channel, handler), on: () => {} }
      export const BrowserWindow = { fromWebContents: () => null }
      export const shell = { openExternal: async () => {} }
    `,
    './drivers/registry': `
      const context = globalThis.__tuyaQrIpc
      export const invalidateDrivers = () => { context.invalidations++ }
      export const listAllDevices = async () => ({ devices: [], statuses: [] })
      export const executeCommand = async () => ({})
    `
  })
  registerIpc()
  return {
    context,
    invoke: (channel, input) => context.handlers.get(channel)({}, input),
    serialized: () => readFileSync(join(directory, 'config.json'), 'utf8')
  }
}

const cloudCredentials = { accessId: 'projeto-anterior', accessSecret: 'segredo-anterior', region: 'us' }

test('QR pelo IPC conecta sem projeto e nunca devolve tokens para renderer', async (t) => {
  const { invoke, context, serialized } = await fixture(t)
  const initial = await invoke('settings:get')
  assert.equal(initial.data.tuya.connection, null)
  const qr = await invoke('tuya:login-start', '12345678')
  assert.equal(qr.ok, true)
  const bytes = Buffer.from(qr.data.qrDataUrl.split(',')[1], 'base64')
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal((await invoke('settings:get')).data.tuya.hasCredentials, false)
  const connected = await invoke('tuya:login-check', qr.data.requestId)
  assert.equal(connected.ok, true)
  assert.equal(connected.data.status, 'connected')
  assert.equal(connected.data.settings.tuya.connection, 'qr')
  assert.equal(connected.data.settings.tuya.userCode, '12345678')
  assert.equal(connected.data.settings.tuya.hasCredentials, true)
  assert.equal(context.invalidations, 1)
  for (const value of [JSON.stringify(connected), JSON.stringify(await invoke('settings:get')), serialized()]) {
    assert.ok(!value.includes('token-acesso-privado'))
    assert.ok(!value.includes('token-renovacao-privado'))
  }
  assert.ok(serialized().includes('tuyaSession'))
  assert.ok(!serialized().includes('tuyaCreds'))
})

test('conectar QR troca credenciais antigas somente depois da confirmação', async (t) => {
  const { invoke, serialized } = await fixture(t)
  await invoke('settings:save-tuya', cloudCredentials)
  const before = serialized()
  const qr = await invoke('tuya:login-start', '12345678')
  assert.equal(serialized(), before)
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, code: 'DENIED', msg: 'access denied' }))
  assert.equal((await invoke('tuya:login-check', qr.data.requestId)).ok, false)
  assert.equal(serialized(), before)
  globalThis.fetch = async () => success(authorization)
  assert.equal((await invoke('tuya:login-check', qr.data.requestId)).data.status, 'connected')
  assert.ok(!serialized().includes('tuyaCreds'))
  assert.equal((await invoke('settings:get')).data.tuya.connection, 'qr')
})

test('falha no cofre ao confirmar mantém projeto anterior e token LG', async (t) => {
  const { invoke, serialized, context } = await fixture(t)
  await invoke('settings:save-thinq', { token: 'lg-preservado', country: 'BR' })
  await invoke('settings:save-tuya', cloudCredentials)
  const before = serialized()
  const qr = await invoke('tuya:login-start', '12345678')
  const invalidations = context.invalidations
  context.available = false
  const result = await invoke('tuya:login-check', qr.data.requestId)
  assert.equal(result.ok, false)
  assert.match(result.error, /cofre/i)
  assert.equal(serialized(), before)
  assert.equal(context.invalidations, invalidations)
  const current = await invoke('settings:get')
  assert.equal(current.data.tuya.connection, 'cloud')
  assert.equal(current.data.thinq.hasToken, true)
})

test('cancelar invalida QR e desconectar funciona offline preservando LG', async (t) => {
  const { invoke, serialized } = await fixture(t)
  await invoke('settings:save-thinq', { token: 'lg-preservado' })
  const qr = await invoke('tuya:login-start', '12345678')
  assert.equal((await invoke('tuya:login-cancel', qr.data.requestId)).ok, true)
  assert.deepEqual((await invoke('tuya:login-check', qr.data.requestId)).data, { status: 'expired' })
  const next = await invoke('tuya:login-start', '12345678')
  await invoke('tuya:login-check', next.data.requestId)
  globalThis.fetch = async () => { throw new Error('desconectar não depende da nuvem') }
  const result = await invoke('tuya:disconnect')
  assert.equal(result.ok, true)
  assert.equal(result.data.tuya.hasCredentials, false)
  assert.equal(result.data.tuya.connection, null)
  assert.equal(result.data.thinq.hasToken, true)
  assert.ok(!serialized().includes('tuyaSession'))
})

test('desconectar durante GET pendente impede que resposta tardia recrie sessão', async (t) => {
  const { invoke, serialized } = await fixture(t)
  await invoke('settings:save-thinq', { token: 'lg-preservado' })
  const qr = await invoke('tuya:login-start', '12345678')
  let release
  const gate = new Promise((resolve) => { release = resolve })
  globalThis.fetch = async () => { await gate; return success(authorization) }
  const pending = invoke('tuya:login-check', qr.data.requestId)
  const disconnected = await invoke('tuya:disconnect')
  assert.equal(disconnected.data.tuya.connection, null)
  release()
  assert.deepEqual((await pending).data, { status: 'expired' })
  assert.equal((await invoke('settings:get')).data.tuya.hasCredentials, false)
  assert.ok(!serialized().includes('tuyaSession'))
})

test('renovação de driver antigo não ressuscita sessão desconectada ou substituída', async (t) => {
  const original = {
    userCode: '12345678', endpoint: 'https://apigw.tuyaus.com', terminalId: 'terminal',
    token: { accessToken: 'access', refreshToken: 'refresh', uid: 'usuario', expiresAt: Date.now() + 7200000 }
  }
  const context = { session: original, refresh: null, writes: 0 }
  globalThis.__tuyaQrRegistry = context
  t.after(() => { delete globalThis.__tuyaQrRegistry })
  const { listAllDevices, invalidateDrivers } = await loadSource('src/main/drivers/registry.ts', {
    '../store': `
      const context = globalThis.__tuyaQrRegistry
      export const getToken = () => null
      export const getCountry = () => 'BR'
      export const getClientId = () => 'cliente'
      export const getTuyaCredentials = () => null
      export const getTuyaRegion = () => 'us'
      export const getTuyaSession = () => context.session
      export const setTuyaSession = (session) => { context.session = session; context.writes++ }
    `,
    './tuya/sharing': `
      const context = globalThis.__tuyaQrRegistry
      export class TuyaSharing {
        constructor(session, refresh) { context.refresh = refresh }
        async listDevices() { return [] }
      }
    `
  })
  await listAllDevices('tuya')
  const refresh = context.refresh
  assert.equal(typeof refresh, 'function')
  context.session = null
  invalidateDrivers()
  assert.throws(() => refresh({ ...original, token: { ...original.token, refreshToken: 'novo' } }), /mudou|conexão/i)
  assert.equal(context.session, null)
  context.session = { ...original, token: { ...original.token, refreshToken: 'outra-conexao' } }
  assert.throws(() => refresh(original), /mudou|conexão/i)
  assert.equal(context.session.token.refreshToken, 'outra-conexao')
  assert.equal(context.writes, 0)
})
