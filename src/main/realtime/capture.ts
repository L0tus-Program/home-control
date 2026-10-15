import { appendFileSync, writeFileSync } from 'node:fs'
import mqtt, { type MqttClient } from 'mqtt'
import { thinqClientFromStore, tuyaSharingFromStore } from '../drivers/registry'
import { createCsr } from '../drivers/thinq/csr'
import { ThinqDriver } from '../drivers/thinq/driver'
import { TuyaDriver } from '../drivers/tuya/driver'
import type { Driver } from '../drivers/types'

/**
 * Diagnostico de desenvolvimento: conecta os MQTTs oficiais com as credenciais
 * ja salvas e grava, sem identificadores nem segredos, o que chega. Serve para
 * conferir o formato real das mensagens antes de depender dele.
 *
 * So roda com `HOME_CONTROL_REALTIME_CAPTURE=1` fora do app empacotado.
 */

const SECRET_KEYS = /^(password|username|accessToken|refreshToken|certificatePem|privateKey|csr|local_key|localKey|token)$/i

class Redactor {
  private readonly aliases = new Map<string, string>()
  private counters = new Map<string, number>()

  alias(value: unknown, prefix: string): void {
    if (typeof value !== 'string' && typeof value !== 'number') return
    const key = String(value)
    if (key.length < 4 || this.aliases.has(key)) return
    const next = (this.counters.get(prefix) ?? 0) + 1
    this.counters.set(prefix, next)
    this.aliases.set(key, `<${prefix}${next}>`)
  }

  text(value: string): string {
    let out = value
    for (const [secret, alias] of this.aliases) out = out.split(secret).join(alias)
    return out
  }

  value(value: unknown, depth = 0): unknown {
    if (depth > 12) return '[profundo]'
    if (typeof value === 'string') return this.text(value)
    if (typeof value === 'number' && this.aliases.has(String(value))) return this.aliases.get(String(value))
    if (Array.isArray(value)) return value.map((item) => this.value(item, depth + 1))
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) =>
        [key, SECRET_KEYS.test(key) ? (item ? '[omitido]' : item) : this.value(item, depth + 1)]))
    }
    return value
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function describe(cause: unknown): Record<string, unknown> {
  if (cause instanceof Error) return { error: cause.message, ...('code' in cause ? { code: (cause as { code?: unknown }).code } : {}) }
  return { error: String(cause) }
}

function brokerUrl(raw: string): string {
  const url = new URL(raw)
  const protocol = url.protocol === 'ssl:' || url.protocol === 'mqtts:' ? 'mqtts:' : url.protocol
  return `${protocol}//${url.hostname}:${url.port || 8883}`
}

export async function runRealtimeCapture(outputPath: string, options: { durationMs: number; probe: boolean }): Promise<void> {
  const redact = new Redactor()
  writeFileSync(outputPath, '')
  const log = (source: string, kind: string, data?: unknown): void => {
    const line = JSON.stringify({ t: new Date().toISOString(), source, kind, ...(data === undefined ? {} : { data: redact.value(data) }) })
    appendFileSync(outputPath, line + '\n')
    console.log(line.length > 400 ? line.slice(0, 400) + '…' : line)
  }
  const clients: MqttClient[] = []
  const cleanups: Array<() => Promise<unknown>> = []
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
      const { csr, privateKeyPem } = createCsr()
      const issued = await thinq.issueCertificate(csr)
      const body = issued && typeof issued.result === 'object' && issued.result ? issued.result as Record<string, unknown> : issued
      const subscriptions = Array.isArray(body?.subscriptions) ? body.subscriptions.filter((item): item is string => typeof item === 'string') : []
      const clientId = thinq.clientId
      redact.alias(clientId, 'lg-client')
      log('lg', 'certificate', { keys: Object.keys(issued ?? {}), bodyKeys: Object.keys(body ?? {}), hasCert: typeof body?.certificatePem === 'string', subscriptions })

      const server = typeof route?.mqttServer === 'string' ? route.mqttServer : ''
      const client = await mqtt.connectAsync(brokerUrl(server), {
        clientId, key: privateKeyPem, cert: String(body?.certificatePem ?? ''),
        protocolVersion: 4, clean: false, keepalive: 60, reconnectPeriod: 0, connectTimeout: 15_000, rejectUnauthorized: true
      })
      clients.push(client)
      log('lg', 'connected', { url: brokerUrl(server) })
      client.on('message', (topic, payload) => {
        let parsed: unknown = payload.toString('utf8')
        try { parsed = JSON.parse(parsed as string) } catch { /* texto cru */ }
        log('lg', 'message', { topic, payload: parsed })
      })
      client.on('error', (error) => log('lg', 'mqtt-error', describe(error)))
      client.on('close', () => log('lg', 'closed'))
      for (const topic of subscriptions) log('lg', 'subscribe', { topic, granted: await client.subscribeAsync(topic, { qos: 1 }) })

      for (const device of devices) {
        log('lg', 'event-subscribe', { id: device.deviceId, result: await thinq.subscribeEvents(device.deviceId).catch(describe) })
        cleanups.push(() => thinq.unsubscribeEvents(device.deviceId).catch(describe))
      }
      log('lg', 'devices-subscribe', await thinq.subscribeDeviceList().catch(describe))
      cleanups.push(() => thinq.unsubscribeDeviceList().catch(describe))

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

      const client = await mqtt.connectAsync(brokerUrl(config.url), {
        clientId: config.clientId, username: config.username, password: config.password,
        protocolVersion: 4, keepalive: 60, reconnectPeriod: 0, connectTimeout: 15_000, rejectUnauthorized: true
      })
      clients.push(client)
      log('tuya', 'connected', { url: brokerUrl(config.url) })
      client.on('message', (topic, payload) => {
        let parsed: unknown = payload.toString('utf8')
        try { parsed = JSON.parse(parsed as string) } catch { /* texto cru */ }
        log('tuya', 'message', { topic, payload: parsed })
      })
      client.on('error', (error) => log('tuya', 'mqtt-error', describe(error)))
      client.on('close', () => log('tuya', 'closed'))
      const topics = [
        ...homes.map((home) => config.ownerTopic.replace('{ownerId}', home)),
        ...devices.map((device) => config.deviceTopic.replace('{devId}', device.id) + (device.local ? '/pen' : '/sta'))
      ]
      for (const topic of topics) log('tuya', 'subscribe', { topic, granted: await client.subscribeAsync(topic, { qos: 1 }) })

      const driver = new TuyaDriver(sharing)
      probes.push(() => probeLights(driver, devices.map((d) => d.id), (kind, data) => log('tuya', kind, data)))
    } catch (cause) {
      log('tuya', 'failure', describe(cause))
    }
  }

  await sleep(3000)
  if (options.probe) {
    for (const probe of probes) await probe().catch((cause) => log('probe', 'failure', describe(cause)))
  }
  log('capture', 'listening', { seconds: Math.round(options.durationMs / 1000) })
  await sleep(options.durationMs)

  for (const cleanup of cleanups) log('capture', 'cleanup', await cleanup())
  await Promise.all(clients.map((client) => client.endAsync().catch(() => undefined)))
  log('capture', 'done')
}

/** Muda algo pequeno e desfaz, para provocar uma mensagem. Nunca liga o ar. */
async function probeAc(driver: Driver, ids: string[], log: (kind: string, data?: unknown) => void): Promise<void> {
  for (const id of ids) {
    const device = await driver.getDevice(id)
    const temp = device.capabilities.find((cap) => cap.kind === 'temperature')
    if (device.kind !== 'air-conditioner' || !device.state.power || !temp || device.state.temperature === undefined) {
      log('probe-skip', { id, power: device.state.power, kind: device.kind })
      continue
    }
    const original = device.state.temperature
    const changed = original + temp.step <= temp.max ? original + temp.step : original - temp.step
    log('probe', { id, command: 'temperature', from: original, to: changed })
    await driver.execute(id, { type: 'temperature', value: changed })
    await sleep(8000)
    log('probe', { id, command: 'temperature', restore: original })
    await driver.execute(id, { type: 'temperature', value: original })
    await sleep(8000)
  }
}

async function probeLights(driver: Driver, ids: string[], log: (kind: string, data?: unknown) => void): Promise<void> {
  for (const id of ids) {
    const device = await driver.getDevice(id).catch(() => null)
    if (!device) continue
    if (device.state.power && device.state.brightness !== undefined) {
      const original = device.state.brightness
      const changed = original > 50 ? original - 20 : original + 20
      log('probe', { id, command: 'brightness', from: original, to: changed })
      await driver.execute(id, { type: 'brightness', value: changed })
      await sleep(6000)
      await driver.execute(id, { type: 'brightness', value: original })
    } else {
      log('probe', { id, command: 'power', from: device.state.power, to: !device.state.power })
      await driver.execute(id, { type: 'power', value: !device.state.power })
      await sleep(6000)
      await driver.execute(id, { type: 'power', value: device.state.power })
    }
    await sleep(6000)
  }
}
