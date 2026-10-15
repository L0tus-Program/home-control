import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'

const { ThinqDriver, energyEntries } = await loadSource('src/main/drivers/thinq/driver.ts')

test('le result.dataList com energyUsage em Wh e datas AAAAMMDD', () => {
  assert.deepEqual(energyEntries({ resultCode: '0000', result: { dataList: [{ usedDate: '20261014', energyUsage: 1250 }, { usedDate: '20261015', energyUsage: 0 }, { energyUsage: 'x' }, { usedDate: 'ontem', energyUsage: 3 }] } }),
    [{ date: '2026-10-14', wh: 1250 }, { date: '2026-10-15', wh: 0 }, { wh: 3 }])
  assert.deepEqual(energyEntries({ result: { dataList: [{ usedDate: '20261014', energyUsage: '1250' }, { usedDate: '20261015', totalEnergy: 7 }] } }),
    [{ date: '2026-10-14', wh: 1250 }, { date: '2026-10-15', wh: 7 }], 'texto numerico e chave de reserva')
  assert.deepEqual(energyEntries(null), [])
})

function client(calls, energyProfile = { resultCode: '0000', result: { property: ['energyUsage'] } }) {
  return {
    listDevices: async () => [{ deviceId: 'ar', deviceInfo: { deviceType: 'DEVICE_AIR_CONDITIONER' } }],
    getProfile: async () => ({ property: {} }),
    getState: async () => ({}),
    getEnergyProfile: async () => energyProfile,
    getEnergyUsage: async (id, property, period, start, end) => {
      calls.push([period, start, end])
      return period === 'DAILY'
        ? { result: { dataList: [{ usedDate: '20261015', energyUsage: 500 }, { usedDate: '20261013', energyUsage: 2100 }] } }
        : { result: { dataList: [{ usedDate: start, energyUsage: start.endsWith('10') ? 30_000 : 41_500 }] } }
    }
  }
}

test('consumo: 7 dias, este mes e o anterior, com cache; capability so com perfil de energia', async () => {
  const calls = []
  const driver = new ThinqDriver(client(calls))
  const [device] = await driver.listDevices()
  assert.ok(device.capabilities.some((cap) => cap.kind === 'energy'))
  const report = await driver.getEnergy('ar')
  assert.deepEqual(report.days, [{ date: '2026-10-13', wh: 2100 }, { date: '2026-10-15', wh: 500 }])
  assert.equal(typeof report.thisMonthWh, 'number')
  assert.deepEqual(calls.map(([period, start, end]) => [period, start.length, end.length]), [['DAILY', 8, 8], ['MONTHLY', 6, 6], ['MONTHLY', 6, 6]])
  await driver.getEnergy('ar')
  assert.equal(calls.length, 3, 'segunda leitura vem do cache')

  const [plain] = await new ThinqDriver(client([], { result: { property: [] } })).listDevices()
  assert.equal(plain.capabilities.some((cap) => cap.kind === 'energy'), false)
  const noApi = client([])
  delete noApi.getEnergyProfile
  const quiet = new ThinqDriver(noApi)
  const [stillThere] = await quiet.listDevices()
  assert.equal(stillThere.kind, 'air-conditioner', 'falha no perfil de energia nao derruba o aparelho')
  await assert.rejects(quiet.getEnergy('ar'), /consumo/)
  await assert.rejects(driver.getEnergy('nao-listado'), /nao encontrado/, 'so aparelhos ja listados')
})

test('datas na virada do ano e falha passageira no perfil e no mes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2027, 0, 1, 9, 0).getTime() })
  const calls = []
  let failMonth = true
  let profileFails = true
  const api = client(calls)
  api.getEnergyProfile = async () => { if (profileFails) throw Object.assign(new Error('cota'), { code: '1306' }); return { result: { property: ['energyUsage'] } } }
  api.getEnergyUsage = async (id, property, period, start, end) => {
    calls.push([period, start, end])
    if (period === 'MONTHLY' && failMonth) throw new Error('rede')
    return { result: { dataList: [{ usedDate: start, energyUsage: 10 }] } }
  }
  const driver = new ThinqDriver(api)
  const [first] = await driver.listDevices()
  assert.equal(first.capabilities.some((cap) => cap.kind === 'energy'), true, 'falha passageira ainda mostra o painel')
  await assert.rejects(driver.getEnergy('ar'), /cota/, 'o painel mostra o motivo')
  profileFails = false
  // Abrir o painel de novo tenta o perfil na hora, sem esperar o intervalo.
  t.mock.timers.setTime(new Date(2027, 0, 1, 9, 3).getTime())

  const partial = await driver.getEnergy('ar')
  assert.equal(partial.thisMonthWh, undefined)
  assert.deepEqual(calls.slice(0, 3), [['DAILY', '20261226', '20270101'], ['MONTHLY', '202701', '202701'], ['MONTHLY', '202612', '202612']])
  failMonth = false
  t.mock.timers.setTime(new Date(2027, 0, 1, 9, 14).getTime())
  const full = await driver.getEnergy('ar')
  assert.equal(full.thisMonthWh, 10, 'leitura incompleta expira cedo')
  const before = calls.length
  await driver.getEnergy('ar')
  assert.equal(calls.length, before, 'leitura completa fica no cache')
  t.mock.timers.setTime(new Date(2027, 0, 2, 0, 5).getTime())
  await driver.getEnergy('ar')
  assert.ok(calls.length > before, 'virou o dia: le de novo')
})
