import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'

const { ThinqDriver, energyEntries } = await loadSource('src/main/drivers/thinq/driver.ts')

test('le result.dataList com energyUsage em Wh e datas AAAAMMDD', () => {
  assert.deepEqual(energyEntries({ resultCode: '0000', result: { dataList: [{ usedDate: '20261014', energyUsage: 1250 }, { usedDate: '20261015', energyUsage: 0 }, { energyUsage: 'x' }, { usedDate: 'ontem', energyUsage: 3 }] } }),
    [{ date: '2026-10-14', wh: 1250 }, { date: '2026-10-15', wh: 0 }, { wh: 3 }])
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
  await assert.rejects(quiet.getEnergy('ar'), /nao informa/)
})
