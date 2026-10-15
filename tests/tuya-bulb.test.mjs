import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'

const { readState, brightnessCommand, colorCommands, bulbCapabilities } = await loadSource('src/main/drivers/tuya/bulb.ts')
const item = (code, value) => ({ code, value })
const fn = (code, values, type = 'Integer') => ({ code, type, values: JSON.stringify(values) })

test('lê HSV V1 e V2 na escala correta, usando brilho da cor ativa', () => {
  const first = readState([
    item('switch_led', true), item('work_mode', 'colour'), item('bright_value', 255),
    item('colour_data', JSON.stringify({ h: 120, s: 128, v: 64 }))
  ], true)
  assert.equal(first.power, true)
  assert.equal(first.brightness, 25)
  assert.deepEqual(first.color, { hue: 120, saturation: 50 })
  const second = readState([
    item('work_mode', 'colour'), item('bright_value_v2', 1000),
    item('colour_data_v2', { h: 240, s: 750, v: 400 })
  ], false)
  assert.equal(second.online, false)
  assert.equal(second.brightness, 40)
  assert.deepEqual(second.color, { hue: 240, saturation: 75 })
})

test('converte brilho com limites e passo publicados pelo dispositivo', () => {
  const functions = [fn('bright_value_v2', { min: 100, max: 900, step: 20 })]
  const status = [item('bright_value_v2', 500), item('work_mode', 'white')]
  assert.equal(readState(status, true, functions).brightness, 51)
  assert.equal(brightnessCommand(status, 1, functions).value, 100)
  assert.deepEqual(brightnessCommand(status, 50, functions), { code: 'bright_value_v2', value: 500 })
  const value = brightnessCommand(status, 53, functions).value
  assert.equal((value - 100) % 20, 0)
  assert.ok(value >= 100 && value <= 900)
  assert.equal(brightnessCommand(status, 999, functions).value, 900)
})

test('ajustar brilho em modo cor mantém matiz e saturação', () => {
  const status = [item('work_mode', 'colour'), item('colour_data_v2', { h: 90, s: 650, v: 800 })]
  assert.deepEqual(brightnessCommand(status, 30), {
    code: 'colour_data_v2', value: { h: 90, s: 650, v: 300 }
  })
  const legacy = [item('work_mode', 'colour'), item('colour_data', { h: 90, s: 128, v: 255 })]
  assert.deepEqual(brightnessCommand(legacy, 50), {
    code: 'colour_data', value: { h: 90, s: 128, v: 128 }
  })
})

test('trocar cor preserva intensidade e usa escala da geração', () => {
  const commands = colorCommands([
    item('work_mode', 'colour'), item('colour_data_v2', { h: 0, s: 1000, v: 350 })
  ], { hue: 180, saturation: 50 })
  assert.ok(commands.some((command) => command.code === 'work_mode' && command.value === 'colour'))
  assert.deepEqual(commands.find((command) => command.code === 'colour_data_v2')?.value, { h: 180, s: 500, v: 350 })
  const legacy = colorCommands([
    item('work_mode', 'colour'), item('colour_data', { h: 0, s: 255, v: 64 })
  ], { hue: 90, saturation: 50 })
  assert.deepEqual(legacy.find((command) => command.code === 'colour_data')?.value, { h: 90, s: 128, v: 64 })
})

test('mudar do branco para cor preserva brilho visível atual', () => {
  const commands = colorCommands([
    item('work_mode', 'white'), item('bright_value_v2', 500),
    item('colour_data_v2', { h: 0, s: 1000, v: 1000 })
  ], { hue: 30, saturation: 100 })
  assert.equal(commands.find((command) => command.code === 'colour_data_v2')?.value.v, 500)
})

test('capabilities usam funções graváveis mesmo quando status está incompleto', () => {
  const caps = bulbCapabilities([item('switch_led', true)], [
    fn('bright_value_v2', { min: 10, max: 1000, step: 1 }),
    fn('colour_data_v2', {}, 'Json')
  ])
  assert.equal(caps.brightness, true)
  assert.equal(caps.color, true)
})

test('HSV inválido não causa falha na leitura do aparelho', () => {
  const state = readState([item('switch_led', true), item('colour_data_v2', '{invalido')], true)
  assert.equal(state.power, true)
  assert.equal(state.color, undefined)
})

test('tom do branco: le e envia temp_value na faixa declarada, passando ao modo branco', async () => {
  const { readState, colorTemperatureCommands, bulbCapabilities } = await loadSource('src/main/drivers/tuya/bulb.ts')
  const functions = [
    { code: 'switch_led', type: 'Boolean', values: '{}' },
    { code: 'work_mode', type: 'Enum', values: '{"range":["white","colour"]}' },
    { code: 'temp_value_v2', type: 'Integer', values: '{"min":0,"max":1000,"step":10}' }
  ]
  const white = [{ code: 'switch_led', value: true }, { code: 'work_mode', value: 'white' }, { code: 'temp_value_v2', value: 250 }]
  assert.equal(readState(white, true, functions).colorTemperature, 25)
  assert.equal(bulbCapabilities(white, functions).colorTemperature, true)
  assert.deepEqual(colorTemperatureCommands(white, 80, functions), [{ code: 'temp_value_v2', value: 800 }])
  assert.deepEqual(colorTemperatureCommands(white, 33.3, functions), [{ code: 'temp_value_v2', value: 330 }], 'respeita o passo')

  // Em cor com V alto e bright_value baixo: a troca para branco leva o brilho atual junto.
  const withBright = [...functions, { code: 'bright_value_v2', type: 'Integer', values: '{"min":10,"max":1000,"step":1}' }, { code: 'colour_data_v2', type: 'Json', values: '{}' }]
  const colour = [{ code: 'switch_led', value: true }, { code: 'work_mode', value: 'colour' }, { code: 'temp_value_v2', value: 0 },
    { code: 'bright_value_v2', value: 100 }, { code: 'colour_data_v2', value: '{"h":0,"s":1000,"v":1000}' }]
  assert.deepEqual(colorTemperatureCommands(colour, 0, withBright), [{ code: 'work_mode', value: 'white' }, { code: 'bright_value_v2', value: 1000 }, { code: 'temp_value_v2', value: 0 }])
  const scene = [{ code: 'switch_led', value: true }, { code: 'work_mode', value: 'scene' }, { code: 'temp_value_v2', value: 0 }]
  assert.deepEqual(colorTemperatureCommands(scene, 50, functions), [{ code: 'work_mode', value: 'white' }, { code: 'temp_value_v2', value: 500 }])

  // v1 sem faixa declarada: 0-255.
  const v1 = [{ code: 'switch_led', value: true }, { code: 'temp_value', value: 255 }]
  assert.equal(readState(v1, true, []).colorTemperature, 100)
  assert.deepEqual(colorTemperatureCommands(v1, 50, []), [{ code: 'temp_value', value: 128 }])

  const none = [{ code: 'switch_led', value: true }]
  assert.equal('colorTemperature' in readState(none, true, []), false)
  assert.equal(bulbCapabilities(none, []).colorTemperature, false)
  assert.throws(() => colorTemperatureCommands(none, 50, []), /tom do branco/)
})

test('confirmacao do tom do branco aceita arredondamento', async () => {
  const { confirmsCommand } = await loadSource('src/main/drivers/registry.ts', {
    '../store': `
      export const getToken = () => null
      export const getCountry = () => 'BR'
      export const getClientId = () => 'c'
      export const getTuyaCredentials = () => null
      export const getTuyaRegion = () => 'us'
      export const getTuyaSession = () => null
      export const getThinqMqttCredentials = () => null
      export const setThinqMqttCredentials = () => {}
      export const setTuyaSession = () => {}
    `
  })
  const matches = confirmsCommand({ type: 'colorTemperature', value: 40 })
  assert.equal(matches({ state: { colorTemperature: 41, mode: 'white' } }), true)
  assert.equal(matches({ state: { colorTemperature: 41 } }), true, 'lampada sem modos')
  assert.equal(matches({ state: { colorTemperature: 60, mode: 'white' } }), false)
  assert.equal(matches({ state: { colorTemperature: 40, mode: 'colour' } }), false, 'tom guardado em modo cor nao confirma')
})
