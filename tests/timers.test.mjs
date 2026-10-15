import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'

const { ThinqDriver } = await loadSource('src/main/drivers/thinq/driver.ts')
const { readState, countdownCommand, readCountdown } = await loadSource('src/main/drivers/tuya/bulb.ts')
const { TuyaDriver } = await loadSource('src/main/drivers/tuya/driver.ts')

const rwNumber = { type: 'number', mode: ['r', 'w'] }
const unset = { type: 'enum', mode: ['r', 'w'], value: { r: ['SET', 'UNSET'], w: ['UNSET'] } }
// Recorte do perfil real do RAC_056905_WW: timers relativos de ligar e desligar.
const profile = { property: {
  operation: { airConOperationMode: { type: 'enum', mode: ['r', 'w'], value: { w: ['POWER_ON', 'POWER_OFF'] } } },
  timer: { relativeHourToStop: rwNumber, relativeMinuteToStop: rwNumber, relativeStopTimer: unset, relativeHourToStart: rwNumber, relativeMinuteToStart: rwNumber, relativeStartTimer: unset }
} }

function lg(state, controls = []) {
  return {
    listDevices: async () => [{ deviceId: 'ar', deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER' } }],
    getProfile: async () => profile,
    getState: async () => state,
    control: async (_id, payload) => { controls.push(payload) }
  }
}

test('LG: timers do perfil viram capability; estado SET vira minutos restantes', async () => {
  const [idle] = await new ThinqDriver(lg({ operation: { airConOperationMode: 'POWER_ON' }, timer: { relativeStartTimer: 'UNSET', relativeStopTimer: 'UNSET' } })).listDevices()
  assert.deepEqual(idle.capabilities.find((cap) => cap.kind === 'timer'), { kind: 'timer', actions: ['on', 'off'], maxMinutes: 1440 })
  assert.equal('timer' in idle.state, false)

  const [running] = await new ThinqDriver(lg({ operation: { airConOperationMode: 'POWER_ON' }, timer: { relativeStopTimer: 'SET', relativeHourToStop: 1, relativeMinuteToStop: 20 } })).listDevices()
  assert.deepEqual(running.state.timer, { off: 80 })
  const [unknown] = await new ThinqDriver(lg({ timer: { relativeStartTimer: 'SET' } })).listDevices()
  assert.deepEqual(unknown.state.timer, { on: 0 }, 'programado sem prazo conhecido')
})

test('LG: programa em horas e minutos e cancela com UNSET', async () => {
  const controls = []
  const driver = new ThinqDriver(lg({}, controls))
  await driver.execute('ar', { type: 'timer', action: 'off', minutes: 90 })
  await driver.execute('ar', { type: 'timer', action: 'on', minutes: 30 })
  await driver.execute('ar', { type: 'timer', action: 'off', minutes: null })
  assert.deepEqual(controls, [
    { timer: { relativeHourToStop: 1, relativeMinuteToStop: 30 } },
    { timer: { relativeHourToStart: 0, relativeMinuteToStart: 30 } },
    { timer: { relativeStopTimer: 'UNSET' } }
  ])
  await assert.rejects(driver.execute('ar', { type: 'timer', action: 'off', minutes: 0 }), /invalido/)
  await assert.rejects(driver.execute('ar', { type: 'timer', action: 'off', minutes: 25 * 60 }), /invalido/)
})

test('Tuya: countdown_1 vira timer de desligar (acesa) ou de ligar (apagada)', () => {
  assert.deepEqual(readCountdown([{ code: 'countdown_1', value: 125 }], true), { timer: { off: 3 } })
  assert.deepEqual(readCountdown([{ code: 'countdown_1', value: 600 }], false), { timer: { on: 10 } })
  assert.deepEqual(readCountdown([{ code: 'countdown_1', value: 0 }], true), {})
  assert.deepEqual(readState([{ code: 'switch_led', value: true }, { code: 'countdown_1', value: 1800 }], true).timer, { off: 30 })
  assert.deepEqual(countdownCommand(15), { code: 'countdown_1', value: 900 })
  assert.deepEqual(countdownCommand(null), { code: 'countdown_1', value: 0 })
  assert.throws(() => countdownCommand(25 * 60), /inválido/)
  assert.throws(() => countdownCommand(5, [{ code: 'countdown_1', type: 'Integer', values: '{"min":0,"max":120}' }]), /inválido/, 'respeita o maximo declarado')
})

test('Tuya: driver expoe o timer e recusa acao incoerente com a energia', async () => {
  const sent = []
  let power = true
  const functions = [{ code: 'switch_led', type: 'Boolean', values: '{}' }, { code: 'countdown_1', type: 'Integer', values: '{"min":0,"max":86400,"step":1}' }]
  const cloud = {
    listDevices: async () => [{ id: 'luz', category: 'dj', name: 'Luz', online: true, status: [{ code: 'switch_led', value: power }] }],
    getDevice: async () => ({ id: 'luz', category: 'dj', name: 'Luz', online: true }),
    getStatus: async () => [{ code: 'switch_led', value: power }],
    getFunctions: async () => ({ functions }),
    sendCommands: async (_id, commands) => { sent.push(...commands) }
  }
  const driver = new TuyaDriver(cloud)
  const [device] = await driver.listDevices()
  assert.deepEqual(device.capabilities.find((cap) => cap.kind === 'timer'), { kind: 'timer', actions: ['off', 'on'], maxMinutes: 1440 })
  await driver.execute('luz', { type: 'timer', action: 'off', minutes: 30 })
  await assert.rejects(driver.execute('luz', { type: 'timer', action: 'on', minutes: 30 }), /acesa/)
  power = false
  await driver.execute('luz', { type: 'timer', action: 'on', minutes: 60 })
  await driver.execute('luz', { type: 'timer', action: 'off', minutes: null })
  assert.deepEqual(sent, [{ code: 'countdown_1', value: 1800 }, { code: 'countdown_1', value: 3600 }, { code: 'countdown_1', value: 0 }])
})
