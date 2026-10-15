import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSource } from './load-source.mjs'

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'home-control-ipc-'))
  const handlers = new Map()
  const context = { directory, handlers, invalidations: 0, listCalls: [] }
  globalThis.__tuyaIpcFixture = context
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url) => {
    requests.push(url)
    const result = url.includes('/token?')
      ? { access_token: 'sessao', expire_time: 7200 }
      : { devices: [], has_more: false }
    return new Response(JSON.stringify({ success: true, result }))
  }
  t.after(() => {
    globalThis.fetch = originalFetch
    delete globalThis.__tuyaIpcFixture
    rmSync(directory, { recursive: true, force: true })
  })
  const { registerIpc } = await loadSource('src/main/ipc.ts', {
    electron: `
      const fixture = globalThis.__tuyaIpcFixture
      export const app = { getPath: () => fixture.directory }
      export const safeStorage = {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from([...value].reverse().join('')),
        decryptString: (value) => [...value.toString()].reverse().join('')
      }
      export const ipcMain = {
        handle: (channel, handler) => fixture.handlers.set(channel, handler),
        on: () => {}
      }
      export const shell = { openExternal: async () => {} }
      export const powerMonitor = { on: () => {} }
      export const BrowserWindow = { fromWebContents: () => null }
    `,
    './drivers/registry': `
      const fixture = globalThis.__tuyaIpcFixture
      export const invalidateDrivers = () => { fixture.invalidations++ }
      export const thinqClientFromStore = () => null
      export const listAllDevices = async (driverId) => {
        fixture.listCalls.push(driverId)
        return { devices: [], statuses: [] }
      }
      export const executeCommand = async () => ({})
    `
  })
  registerIpc()
  return {
    context, requests,
    invoke: (channel, input) => handlers.get(channel)({}, input),
    serialized: () => readFileSync(join(directory, 'config.json'), 'utf8')
  }
}

const credentials = { accessId: 'id-tuya', accessSecret: 'secret-tuya', region: 'us' }

test('salvar Tuya testa descoberta e retorna apenas indicadores sem segredo', async (t) => {
  const { invoke, requests, serialized, context } = await fixture(t)
  const result = await invoke('settings:save-tuya', credentials)
  assert.deepEqual(result, {
    ok: true,
    data: { thinq: { country: 'BR', hasToken: false }, tuya: { region: 'us', hasCredentials: true, connection: 'cloud' } }
  })
  assert.equal(requests.length, 2)
  assert.ok(requests[1].includes('/associated-users/devices?size=20'))
  assert.equal(context.invalidations, 1)
  assert.ok(!JSON.stringify(await invoke('settings:get')).includes('secret-tuya'))
  assert.ok(!serialized().includes('secret-tuya'))
})

test('conexão recusada preserva credenciais e região anteriores', async (t) => {
  const { invoke, serialized, context } = await fixture(t)
  await invoke('settings:save-tuya', credentials)
  const previous = serialized()
  globalThis.fetch = async () => new Response(JSON.stringify({ success: false, code: 1106, msg: 'permission denied' }))
  const result = await invoke('settings:save-tuya', { accessId: 'novo', accessSecret: 'outro', region: 'eu' })
  assert.equal(result.ok, false)
  assert.match(result.error, /permissão/i)
  assert.equal(serialized(), previous)
  assert.equal(context.invalidations, 1)
})

test('credenciais parciais e datacenter inválido falham sem apagar conexão', async (t) => {
  const { invoke, serialized, requests } = await fixture(t)
  await invoke('settings:save-tuya', credentials)
  const previous = serialized()
  for (const input of [
    { accessId: 'novo', region: 'us' },
    { accessId: 'novo', accessSecret: '', region: 'us' },
    { ...credentials, region: 'https://servidor-invalido.example' }
  ]) {
    assert.equal((await invoke('settings:save-tuya', input)).ok, false)
    assert.equal(serialized(), previous)
  }
  assert.equal(requests.length, 2)
})

test('trocar datacenter reutiliza par salvo e valida no endpoint escolhido', async (t) => {
  const { invoke, requests } = await fixture(t)
  await invoke('settings:save-tuya', credentials)
  const result = await invoke('settings:save-tuya', { region: 'eu' })
  assert.equal(result.ok, true)
  assert.equal(result.data.tuya.region, 'eu')
  assert.equal(result.data.tuya.hasCredentials, true)
  assert.ok(requests[2].startsWith('https://openapi.tuyaeu.com/'))
})

test('desconectar Tuya funciona sem nuvem e mantém configuração LG', async (t) => {
  const { invoke, requests } = await fixture(t)
  await invoke('settings:save-thinq', { token: 'token-lg', country: 'BR' })
  await invoke('settings:save-tuya', credentials)
  globalThis.fetch = async () => { throw new Error('não deve consultar a nuvem para desconectar') }
  const result = await invoke('settings:save-tuya', { accessId: '', accessSecret: '', region: 'us' })
  assert.equal(result.ok, true)
  assert.equal(result.data.tuya.hasCredentials, false)
  assert.equal(result.data.thinq.hasToken, true)
  assert.equal(requests.length, 2)
})

test('devices:list encaminha a integração selecionada para evitar consultas LG', async (t) => {
  const { invoke, context } = await fixture(t)
  assert.equal((await invoke('devices:list', 'tuya')).ok, true)
  assert.deepEqual(context.listCalls, ['tuya'])
})
