import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'

const { ThinqDriver } = await loadSource('src/main/drivers/thinq/driver.ts')

const rw = (type, w) => ({ type, mode: ['r', 'w'], value: { r: w, w } })
// Recorte do perfil real do RAC_056905_WW (15/10/2026).
const profile = {
  property: {
    airConJobMode: { currentJobMode: rw('enum', ['HEAT', 'COOL']) },
    operation: { airConOperationMode: rw('enum', ['POWER_OFF', 'POWER_ON']) },
    powerSave: { powerSaveEnabled: rw('boolean', [false, true]) },
    windDirection: { rotateUpDown: rw('boolean', [true, false]) },
    filterInfo: { filterLifetime: { type: 'number', mode: ['r'] }, usedTime: { type: 'number', mode: ['r'] } },
    temperatureInUnits: [{ unit: 'C', coolTargetTemperature: { type: 'range', mode: ['w'], value: { w: { min: 18, max: 30, step: 0.5 } } } }]
  }
}
const state = {
  operation: { airConOperationMode: 'POWER_ON' }, airConJobMode: { currentJobMode: 'COOL' },
  powerSave: { powerSaveEnabled: false }, windDirection: { rotateUpDown: true },
  temperatureInUnits: [{ unit: 'C', targetTemperature: 24, currentTemperature: 25 }]
}

function client(controls = []) {
  return {
    listDevices: async () => [{ deviceId: 'ar', deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER', modelName: 'RAC' } }],
    getProfile: async () => profile,
    getState: async () => state,
    control: async (id, payload) => { controls.push(payload) }
  }
}

test('ajustes graváveis do perfil viram capabilities e estado; os ausentes nao aparecem', async () => {
  const [device] = await new ThinqDriver(client()).listDevices()
  const options = device.capabilities.filter((cap) => cap.kind === 'option').map((cap) => cap.key)
  assert.deepEqual(options, ['powerSave', 'swingVertical'])
  assert.deepEqual(device.state.options, { powerSave: false, swingVertical: true })
})

test('comando de ajuste vai no recurso do perfil; ajuste que o modelo nao tem e recusado', async () => {
  const controls = []
  const driver = new ThinqDriver(client(controls))
  await driver.execute('ar', { type: 'option', key: 'powerSave', value: true })
  await driver.execute('ar', { type: 'option', key: 'swingVertical', value: false })
  assert.deepEqual(controls, [{ powerSave: { powerSaveEnabled: true } }, { windDirection: { rotateUpDown: false } }])
  await assert.rejects(driver.execute('ar', { type: 'option', key: 'swingHorizontal', value: true }), /nao tem esse ajuste/)
})

test('sensor de particulas: so os valores publicados; modelo sem sensor nao ganha o campo', async () => {
  const [plain] = await new ThinqDriver(client()).listDevices()
  assert.equal('airQuality' in plain.state, false)
  const withSensor = client()
  withSensor.getState = async () => ({ ...state, airQualitySensor: { PM2: 12, PM10: 30, humidity: 55, odor: 'x' } })
  const [device] = await new ThinqDriver(withSensor).listDevices()
  assert.deepEqual(device.state.airQuality, { pm25: 12, pm10: 30 })
  assert.equal(device.state.humidity, 55)
})

test('so entram ajustes legiveis, booleanos e com os dois valores', async () => {
  const odd = client()
  odd.getProfile = async () => ({ property: { ...profile.property,
    powerSave: { powerSaveEnabled: { type: 'boolean', mode: ['w'], value: { w: [true, false] } } },
    windDirection: { rotateUpDown: rw('boolean', [true]), rotateLeftRight: rw('enum', ['ON', 'OFF']) }
  } })
  const [device] = await new ThinqDriver(odd).listDevices()
  assert.deepEqual(device.capabilities.filter((cap) => cap.kind === 'option'), [])
})

test('relato parcial do MQTT atualiza so o ajuste que mudou', async () => {
  const { mergeReport } = await loadSource('src/main/drivers/thinq/realtime.ts')
  const merged = mergeReport(state, { windDirection: { rotateUpDown: false } })
  assert.deepEqual(merged.powerSave, { powerSaveEnabled: false })
  assert.deepEqual(merged.windDirection, { rotateUpDown: false })
})
