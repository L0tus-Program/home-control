import { appendFileSync, writeFileSync } from 'node:fs'
import mqtt, { type IClientOptions, type MqttClient } from 'mqtt'
import { thinqClientFromStore, tuyaSharingFromStore } from '../drivers/registry'
import { createCsr } from '../drivers/thinq/csr'
import { ThinqDriver } from '../drivers/thinq/driver'
import { TuyaDriver } from '../drivers/tuya/driver'
import type { Driver } from '../drivers/types'
import { LG_BROKER_DOMAINS, secureBrokerUrl, TUYA_BROKER_DOMAINS } from './broker'
import { Redactor } from './redact'

/**
 * Diagnostico de desenvolvimento: conecta os MQTTs oficiais com as credenciais
 * ja salvas e grava, sem identificadores nem segredos, o que chega. Serve para
 * conferir o formato real das mensagens antes de depender dele.
 *
 * So roda com `HOME_CONTROL_REALTIME_CAPTURE=1` fora do app empacotado.
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function describe(cause: unknown): Record<string, unknown> {
  if (cause instanceof Error) return { error: cause.message, ...('code' in cause ? { code: (cause as { code?: unknown }).code } : {}) }
  return { error: String(cause) }
}

/** Liga os handlers antes do CONNACK: o backlog QoS 1 chega logo depois dele. */
function connect(url: string, options: IClientOptions, onMessage: (topic: string, payload: unknown) => void): Promise<MqttClient> {
  const client = mqtt.connect(url, { ...options, reconnectPeriod: 0, connectTimeout: 15_000, rejectUnauthorized: true })
  client.on('message', (topic, payload) => {
    let parsed: unknown = payload.toString('utf8')
    try { parsed = JSON.parse(parsed as string) } catch { /* texto cru */ }
    onMessage(topic, parsed)
  })
  return new Promise((resolve, reject) => {
    client.once('connect', () => resolve(client))
    client.once('error', (error) => { client.end(true); reject(error) })
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | { error: string }> {
  return Promise.race([promise, new Promise<{ error: string }>((resolve) => setTimeout(() => resolve({ error: 'tempo esgotado' }), ms))])
}

export async function runRealtimeCapture(outputPath: string, options: { durationMs: number; probe: boolean }): Promise<void> {
  const redact = new Redactor()
  writeFileSync(outputPath, '', { mode: 0o600 })
  const log = (source: string, kind: string, data?: unknown): void => {
    const line = JSON.stringify({ t: new Date().toISOString(), source, kind, ...(data === undefined ? {} : { data: redact.value(data) }) })
    appendFileSync(outputPath, line + '\n')
    console.log(line.length > 400 ? line.slice(0, 400) + '…' : line)
  }
  const clients: MqttClient[] = []
  const probes: Array<() => Promise<void>> = []

  // ── LG ────────────────────────────────────────────────────────────────────
  const thinq = thinqClientFromStore()
  if (!thinq) log('lg', 'skip', 'sem token')
  else {
    try {
      const devices = (await thinq.listDevices()) ?? []
      for (const device of devices) redact.alias(device.deviceId, 'lg-dev')
      log('lg', 'devices', devices.map((d) => ({ id: d.deviceId, type: d.deviceInfo?.deviceType, model: d.deviceInfo?.modelName })))
      log('lg', 'register', await thinq.registerClient().catch(describe))
      const route = await thinq.getRoute()
      log('lg', 'route', route)
      const { csr, privateKeyPem } = await createCsr()
      const issued = await thinq.issueCertificate(csr)
      const body = issued && typeof issued.result === 'object' && issued.result ? issued.result as Record<string, unknown> : issued
      const subscriptions = Array.isArray(body?.subscriptions) ? body.subscriptions.filter((item): item is string => typeof item === 'string') : []
      const clientId = thinq.clientId
      redact.alias(clientId, 'lg-client')
      log('lg', 'certificate', { keys: Object.keys(issued ?? {}), bodyKeys: Object.keys(body ?? {}), issued: typeof body?.certificatePem === 'string', subscriptions })

      const url = secureBrokerUrl(route?.mqttServer, LG_BROKER_DOMAINS)
      const client = await connect(url, {
        clientId, key: privateKeyPem, cert: String(body?.certificatePem ?? ''), protocolVersion: 4, clean: false, keepalive: 60
      }, (topic, payload) => log('lg', 'message', { topic, payload }))
      clients.push(client)
      log('lg', 'connected', { url })
      client.on('error', (error) => log('lg', 'mqtt-error', describe(error)))
      client.on('close', () => log('lg', 'closed'))
      for (const topic of subscriptions) log('lg', 'subscribe', { topic, granted: await withTimeout(client.subscribeAsync(topic, { qos: 1 }), 10_000) })

      // As assinaturas ficam: sao do mesmo client id que o app usa no tempo real.
      for (const device of devices) {
        log('lg', 'event-subscribe', { id: device.deviceId, result: await thinq.subscribeEvents(device.deviceId).catch(describe) })
      }
      log('lg', 'devices-subscribe', await thinq.subscribeDeviceList().catch(describe))

      const driver = new ThinqDriver(thinq)
      probes.push(() => probeAc(driver, devices.map((d) => d.deviceId), (kind, data) => log('lg', kind, data)))
    } catch (cause) {
      log('lg', 'failure', describe(cause))
    }
  }

  // ── Tuya ──────────────────────────────────────────────────────────────────
  const sharing = tuyaSharingFromStore()
  if (!sharing) log('tuya', 'skip', 'sem conexao por QR Code')
  else {
    try {
      const homes = await sharing.listHomeIds()
      for (const home of homes) redact.alias(home, 'tuya-home')
      const devices = await sharing.listDevices()
      for (const device of devices) redact.alias(device.id, 'tuya-dev')
      log('tuya', 'devices', devices)
      const config = await sharing.getMqttConfig()
      redact.alias(config.clientId, 'tuya-client')
      redact.alias(config.username, 'tuya-user')
      log('tuya', 'config', { url: config.url, expireTime: config.expireTime, ownerTopic: config.ownerTopic, deviceTopic: config.deviceTopic })

      const url = secureBrokerUrl(config.url, TUYA_BROKER_DOMAINS)
      const client = await connect(url, {
        clientId: config.clientId, username: config.username, password: config.password, protocolVersion: 4, keepalive: 60
      }, (topic, payload) => log('tuya', 'message', { topic, payload }))
      clients.push(client)
      log('tuya', 'connected', { url })
      client.on('error', (error) => log('tuya', 'mqtt-error', describe(error)))
      client.on('close', () => log('tuya', 'closed'))
      const topics = [
        ...homes.map((home) => config.ownerTopic.replace('{ownerId}', home)),
        ...devices.map((device) => config.deviceTopic.replace('{devId}', device.id) + (device.local ? '/pen' : '/sta'))
      ]
      for (const topic of topics) log('tuya', 'subscribe', { topic, granted: await withTimeout(client.subscribeAsync(topic, { qos: 1 }), 10_000) })

      const driver = new TuyaDriver(sharing)
      probes.push(() => probeLights(driver, devices.map((d) => d.id), (kind, data) => log('tuya', kind, data)))
    } catch (cause) {
      log('tuya', 'failure', describe(cause))
    }
  }

  await sleep(3000)
  if (options.probe) {
    for (const probe of probes) await probe()
  }
  log('capture', 'listening', { seconds: Math.round(options.durationMs / 1000) })
  await sleep(options.durationMs)

  await withTimeout(Promise.all(clients.map((client) => client.endAsync().catch(() => undefined))), 5000)
  log('capture', 'done')
}

/**
 * Muda algo pequeno e desfaz, para provocar uma mensagem. Nunca liga o ar;
 * lampadas apagadas acendem por alguns segundos. A restauracao roda mesmo se a
 * mudanca falhar, e o valor original fica no log para conserto manual.
 */
async function probeAc(driver: Driver, ids: string[], log: (kind: string, data?: unknown) => void): Promise<void> {
  for (const id of ids) {
    try {
      const device = await driver.getDevice(id)
      const temp = device.capabilities.find((cap) => cap.kind === 'temperature')
      const original = device.state.temperature
      if (device.kind !== 'air-conditioner' || !device.state.power || temp?.kind !== 'temperature' ||
          original === undefined || !Number.isFinite(temp.step) || temp.step <= 0) {
        log('probe-skip', { id, power: device.state.power, kind: device.kind })
        continue
      }
      const changed = original + temp.step <= temp.max ? original + temp.step : original - temp.step
      log('probe', { id, command: 'temperature', from: original, to: changed })
      try {
        await driver.execute(id, { type: 'temperature', value: changed })
        await sleep(8000)
      } finally {
        log('probe', { id, command: 'temperature', restore: original })
        await driver.execute(id, { type: 'temperature', value: original })
      }
      await sleep(8000)
    } catch (cause) {
      log('probe-failure', { id, ...describe(cause) })
    }
  }
}

async function probeLights(driver: Driver, ids: string[], log: (kind: string, data?: unknown) => void): Promise<void> {
  for (const id of ids) {
    try {
      const device = await driver.getDevice(id)
      const brightness = device.state.brightness
      if (device.state.power && brightness !== undefined) {
        const changed = brightness > 50 ? brightness - 20 : brightness + 20
        log('probe', { id, command: 'brightness', from: brightness, to: changed })
        try {
          await driver.execute(id, { type: 'brightness', value: changed })
          await sleep(6000)
        } finally {
          await driver.execute(id, { type: 'brightness', value: brightness })
        }
      } else {
        log('probe', { id, command: 'power', from: device.state.power, to: !device.state.power })
        try {
          await driver.execute(id, { type: 'power', value: !device.state.power })
          await sleep(6000)
        } finally {
          await driver.execute(id, { type: 'power', value: device.state.power })
        }
      }
      await sleep(6000)
    } catch (cause) {
      log('probe-failure', { id, ...describe(cause) })
    }
  }
}
