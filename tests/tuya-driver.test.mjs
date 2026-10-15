import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'

const { TuyaDriver } = await loadSource('src/main/drivers/tuya/driver.ts')
const functions = [
  { code: 'switch_led', type: 'Boolean', values: '{}' },
  { code: 'bright_value_v2', type: 'Integer', values: '{"min":100,"max":900,"step":20}' },
  { code: 'colour_data_v2', type: 'Json', values: '{}' },
  { code: 'work_mode', type: 'Enum', values: '{"range":["white","colour","scene","music"]}' }
]

function cloudFixture(overrides = {}) {
  return {
    listDevices: async () => [{ id: 'luz', category: 'dj', name: 'Sala', online: true }],
    getDevice: async () => ({ id: 'luz', category: 'dj', name: 'Sala', online: false }),
    getStatus: async () => [{ code: 'switch_led', value: true }, { code: 'bright_value_v2', value: 500 }],
    getFunctions: async () => ({ functions }),
    sendCommands: async () => {},
    ...overrides
  }
}

test('driver sem credenciais informa configuração pendente', async () => {
  const driver = new TuyaDriver(null)
  assert.equal(driver.isConfigured(), false)
  await assert.rejects(driver.listDevices(), /credenciais|configur/i)
})

test('lista somente luzes e expõe controles declarados nas funções', async () => {
  const cloud = cloudFixture({
    listDevices: async () => [
      { id: 'luz', category: 'dj', name: 'Sala', online: true },
      { id: 'tomada', category: 'cz', name: 'Tomada', online: true }
    ],
    getStatus: async (id) => {
      assert.equal(id, 'luz')
      return [{ code: 'switch_led', value: true }]
    }
  })
  const devices = await new TuyaDriver(cloud).listDevices()
  assert.equal(devices.length, 1)
  assert.equal(devices[0].driverId, 'tuya')
  assert.equal(devices[0].name, 'Sala')
  assert.ok(devices[0].capabilities.some((capability) => capability.kind === 'brightness'))
  assert.ok(devices[0].capabilities.some((capability) => capability.kind === 'color'))
  const mode = devices[0].capabilities.find((capability) => capability.kind === 'mode')
  assert.deepEqual(mode?.options, ['white', 'colour'])
})

test('atualiza online pela consulta individual após comando', async () => {
  const cloud = cloudFixture({ listDevices: async () => { throw new Error('não deve relistar a conta') } })
  const device = await new TuyaDriver(cloud).getDevice('luz')
  assert.equal(device.state.online, false)
})

test('executa brilho com faixa de funções e modo branco/cor', async () => {
  const sent = []
  const driver = new TuyaDriver(cloudFixture({ sendCommands: async (id, commands) => { sent.push({ id, commands }) } }))
  await driver.execute('luz', { type: 'brightness', value: 50 })
  assert.deepEqual(sent[0], { id: 'luz', commands: [{ code: 'bright_value_v2', value: 500 }] })
  await driver.execute('luz', { type: 'mode', value: 'colour' })
  assert.deepEqual(sent[1], { id: 'luz', commands: [{ code: 'work_mode', value: 'colour' }] })
  await assert.rejects(driver.execute('luz', { type: 'temperature', value: 20 }))
})

test('cenas pelo driver: id junta casa e cena; id malformado e recusado; sem suporte, lista vazia', async () => {
  const triggered = []
  const driver = new TuyaDriver(cloudFixture({
    listScenes: async () => [{ homeId: '12', sceneId: 'abc', name: 'Cinema', enabled: true }],
    triggerScene: async (home, scene) => { triggered.push([home, scene]) }
  }))
  assert.deepEqual(await driver.listScenes(), [{ id: '12:abc', driverId: 'tuya', name: 'Cinema', enabled: true }])
  await driver.runScene('12:abc')
  assert.deepEqual(triggered, [['12', 'abc']])
  await assert.rejects(driver.runScene('12:abc/../x'), /inválida/)
  assert.deepEqual(await new TuyaDriver(cloudFixture()).listScenes(), [])
})
