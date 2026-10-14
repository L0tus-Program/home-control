import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSource } from './load-source.mjs'

async function storeFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'home-control-test-'))
  const fixture = { available: true, directory, decryptFails: false }
  globalThis.__tuyaStoreFixture = fixture
  t.after(() => {
    delete globalThis.__tuyaStoreFixture
    rmSync(directory, { recursive: true, force: true })
  })
  const store = await loadSource('src/main/store.ts', {
    electron: `
      const fixture = globalThis.__tuyaStoreFixture
      export const app = { getPath: () => fixture.directory }
      export const safeStorage = {
        isEncryptionAvailable: () => fixture.available,
        encryptString: (value) => Buffer.from([...value].reverse().join('')),
        decryptString: (value) => {
          if (fixture.decryptFails) throw new Error('cofre indisponível')
          return [...value.toString()].reverse().join('')
        }
      }
    `
  })
  return { store, fixture, path: join(directory, 'config.json') }
}

test('guarda par Tuya cifrado, normaliza espaços e preserva integração LG', async (t) => {
  const { store, path } = await storeFixture(t)
  store.setToken('token-lg')
  store.setTuyaCredentials({ accessId: '  acesso-tuya  ', accessSecret: '  segredo-tuya  ' })
  assert.equal(store.hasTuyaCredentials(), true)
  assert.deepEqual(store.getTuyaCredentials(), { accessId: 'acesso-tuya', accessSecret: 'segredo-tuya' })
  assert.equal(store.getToken(), 'token-lg')
  const serialized = readFileSync(path, 'utf8')
  assert.ok(!serialized.includes('acesso-tuya'))
  assert.ok(!serialized.includes('segredo-tuya'))
})

test('sem cofre seguro não grava credenciais nem perde configuração anterior', async (t) => {
  const { store, fixture, path } = await storeFixture(t)
  store.setTuyaCredentials({ accessId: 'anterior', accessSecret: 'segredo' })
  const previous = readFileSync(path, 'utf8')
  fixture.available = false
  assert.throws(() => store.setTuyaCredentials({ accessId: 'novo', accessSecret: 'outro' }), /cofre/i)
  assert.equal(readFileSync(path, 'utf8'), previous)
})

test('desvincular Tuya apaga só suas credenciais', async (t) => {
  const { store } = await storeFixture(t)
  store.setToken('token-lg')
  store.setTuyaCredentials({ accessId: 'acesso', accessSecret: 'segredo' })
  store.setTuyaCredentials(null)
  assert.equal(store.hasTuyaCredentials(), false)
  assert.equal(store.getTuyaCredentials(), null)
  assert.equal(store.getToken(), 'token-lg')
})

test('credenciais indecifráveis e arquivo inválido não derrubam as preferências', async (t) => {
  const { store, fixture, path } = await storeFixture(t)
  store.setTuyaCredentials({ accessId: 'acesso', accessSecret: 'segredo' })
  fixture.decryptFails = true
  assert.equal(store.getTuyaCredentials(), null)
  assert.equal(store.hasTuyaCredentials(), false)
  writeFileSync(path, '{quebrado', 'utf8')
  assert.equal(store.getTuyaCredentials(), null)
  assert.equal(store.hasTuyaCredentials(), false)
})

test('salvar Tuya não troca região se a criptografia falhar', async (t) => {
  const { store, fixture, path } = await storeFixture(t)
  store.saveTuyaConfiguration({ accessId: 'anterior', accessSecret: 'segredo' }, 'us')
  const previous = readFileSync(path, 'utf8')
  fixture.available = false
  assert.throws(() => store.saveTuyaConfiguration({ accessId: 'novo', accessSecret: 'outro' }, 'eu'), /cofre/i)
  assert.equal(readFileSync(path, 'utf8'), previous)
  assert.equal(store.getTuyaRegion(), 'us')
})
