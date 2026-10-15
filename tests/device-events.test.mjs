import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'

const { applyDeviceEvents } = await loadSource('src/renderer/src/hooks/deviceEvents.ts')
const { mergeRead } = await loadSource('src/renderer/src/hooks/useDevices.ts')

const device = (driverId, id, state = {}) => ({ id, driverId, name: id, kind: 'light', capabilities: [], state: { online: true, power: false, ...state } })
const none = new Set()

test('estado por evento troca o aparelho pela chave composta', () => {
  const list = [device('tuya', 'a'), device('thinq', 'a')]
  const result = applyDeviceEvents(list, { driverId: 'tuya', events: [{ type: 'state', device: device('tuya', 'a', { power: true }) }] }, none)
  assert.equal(result.devices[0].state.power, true)
  assert.equal(result.devices[1], list[1])
  assert.deepEqual(result.touched, ['tuya:a'])
  assert.equal(result.needsRefresh, false)
  assert.equal(list[0].state.power, false, 'nao altera a lista original')
})

test('comando em voo ignora estado do evento, mas aviso de disponibilidade passa', () => {
  const list = [device('tuya', 'a')]
  const pending = new Set(['tuya:a'])
  const result = applyDeviceEvents(list, { driverId: 'tuya', events: [
    { type: 'state', device: device('tuya', 'a', { power: true }) },
    { type: 'availability', deviceId: 'a', online: false }
  ] }, pending)
  assert.equal(result.devices[0].state.power, false)
  assert.equal(result.devices[0].state.online, false)
})

test('aparelho desconhecido ou pedido explicito levam a releitura; driver alheio e ignorado', () => {
  const list = [device('tuya', 'a')]
  assert.equal(applyDeviceEvents(list, { driverId: 'tuya', events: [{ type: 'state', device: device('tuya', 'novo') }] }, none).needsRefresh, true)
  assert.equal(applyDeviceEvents(list, { driverId: 'tuya', events: [{ type: 'refresh' }] }, none).needsRefresh, true)
  const foreign = applyDeviceEvents(list, { driverId: 'tuya', events: [{ type: 'state', device: device('thinq', 'a', { power: true }) }] }, none)
  assert.equal(foreign.devices, list)
  assert.equal(foreign.needsRefresh, false)
})

test('nada muda: devolve a mesma lista', () => {
  const list = [device('tuya', 'a')]
  const result = applyDeviceEvents(list, { driverId: 'tuya', events: [{ type: 'availability', deviceId: 'a', online: true }, { type: 'availability', deviceId: 'x', online: false }] }, none)
  assert.equal(result.devices, list)
  assert.deepEqual(result.touched, [])
})

test('leitura que comecou antes de um evento nao sobrescreve o aparelho atualizado', () => {
  const statuses = [{ id: 'tuya', label: 'Tuya', configured: true }]
  const current = { devices: [device('tuya', 'a', { power: true }), device('tuya', 'b')], statuses }
  const fresh = { devices: [device('tuya', 'a', { power: false }), device('tuya', 'b', { power: true })], statuses }
  const merged = mergeRead(current, fresh, ['tuya'], (key) => key === 'tuya:a')
  assert.equal(merged.devices[0].state.power, true)
  assert.equal(merged.devices[1].state.power, true)
})
