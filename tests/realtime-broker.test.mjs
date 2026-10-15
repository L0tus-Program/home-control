import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './load-source.mjs'

const { secureBrokerUrl, LG_BROKER_DOMAINS, TUYA_BROKER_DOMAINS } = await loadSource('src/main/realtime/broker.ts')
const { Redactor } = await loadSource('src/main/realtime/redact.ts')

test('broker: so TLS e so nos dominios oficiais', () => {
  assert.equal(secureBrokerUrl('mqtts://a1-ats.iot.us-west-2.amazonaws.com:8883', LG_BROKER_DOMAINS), 'mqtts://a1-ats.iot.us-west-2.amazonaws.com:8883')
  assert.equal(secureBrokerUrl('ssl://m1.tuyaus.com:8883', TUYA_BROKER_DOMAINS), 'mqtts://m1.tuyaus.com:8883')
  assert.equal(secureBrokerUrl('ssl://m1.tuyaeu.com', TUYA_BROKER_DOMAINS), 'mqtts://m1.tuyaeu.com:8883')
  for (const bad of ['tcp://m1.tuyaus.com:1883', 'mqtt://m1.tuyaus.com', 'ws://m1.tuyaus.com', 'ssl://tuyaus.com.evil.io:8883',
    'ssl://user:pw@m1.tuyaus.com:8883', 'ssl://m1.tuyaus.com:99999', '', null, 'nao e url']) {
    assert.throws(() => secureBrokerUrl(bad, TUYA_BROKER_DOMAINS), undefined, String(bad))
  }
  assert.throws(() => secureBrokerUrl('mqtts://m1.tuyaus.com:8883', LG_BROKER_DOMAINS))
})

test('redator: nenhum id ou segredo sobrevive na captura', () => {
  const redact = new Redactor()
  redact.alias('device-123456', 'dev')
  redact.alias('device-123456-extra', 'dev')
  redact.alias(987654321, 'home')
  redact.alias('abc', 'curto')
  const out = JSON.stringify(redact.value({
    topic: 'cloud/device-123456-extra/sta', ownerId: 987654321,
    data: { devId: 'device-123456', name: 'Sala do Felipe', access_token: 'tok', refreshToken: 'r', password: 'p', local_key: 'k', sign: 's', certificatePem: 'c' },
    list: [{ alias: 'Luz', value: 'abc' }]
  }))
  for (const secret of ['device-123456', '987654321', 'Sala do Felipe', '"tok"', '"p"', '"k"', '"s"', '"c"', 'Luz']) {
    assert.equal(out.includes(secret), false, secret)
  }
  assert.ok(out.includes('cloud/<dev2>/sta'), 'id longo trocado inteiro, antes do curto')
  assert.ok(out.includes('"ownerId":"<home1>"'))
  assert.ok(out.includes('"value":"abc"'), 'ids curtos demais nao viram apelido')
})
