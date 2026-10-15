import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSource } from './load-source.mjs'

const directory = mkdtempSync(join(tmpdir(), 'home-control-store-'))
globalThis.__storeDir = directory
const store = await loadSource('src/main/store.ts', {
  electron: `
    export const app = { getPath: () => globalThis.__storeDir }
    export const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString()
    }
  `
})

test('grava de forma atomica e nunca sobrescreve preferencias que nao conseguiu ler', (t) => {
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  store.setCountry('ar')
  assert.equal(JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8')).thinqCountry, 'AR')
  assert.deepEqual(readdirSync(directory).filter((name) => name.endsWith('.tmp')), [], 'sem temporario sobrando')

  // Arquivo ilegivel (aqui, um diretorio no lugar): leitura vira vazio, mas nada e gravado por cima.
  rmSync(join(directory, 'config.json'))
  mkdirSync(join(directory, 'config.json'))
  assert.equal(store.getCountry(), 'BR')
  assert.throws(() => store.setCountry('cl'), /preferências/)
  rmSync(join(directory, 'config.json'), { recursive: true })

  writeFileSync(join(directory, 'config.json'), JSON.stringify({ thinqCountry: 'PE', thinqMqtt: 'x' }))
  store.setToken('novo-token')
  const saved = JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'))
  assert.equal(saved.thinqMqtt, undefined, 'token novo descarta o certificado do MQTT')
  assert.equal(saved.thinqCountry, 'PE')
})
