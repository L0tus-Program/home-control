import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tuyaEndpoint } from '../shared/tuya'
import type { TuyaSharingSession } from '../shared/tuya'
import { assertTuyaSharingEndpoint } from './drivers/tuya/sharing'

/**
 * Configuracao em disco, no userData do app.
 *
 * O token da LG nunca fica em texto puro: usa o cofre do sistema (DPAPI no
 * Windows, Keychain no macOS) via safeStorage. Se o cofre nao estiver
 * disponivel, preferimos nao gravar o token a grava-lo exposto.
 */

interface PersistedConfig {
  /** Token cifrado, em base64. */
  thinqToken?: string
  thinqCountry?: string
  /** A LG bloqueia contas que criam muitos client ids; este e fixo por instalacao. */
  clientId?: string
  /** Credenciais da Tuya Cloud (Access ID + Secret) cifradas juntas, em base64. */
  tuyaCreds?: string
  tuyaRegion?: string
  /** Tokens de autorização QR cifrados; independentes do token LG. */
  tuyaSession?: string
}

export interface TuyaCredentials {
  accessId: string
  accessSecret: string
}

const CONFIG_PATH = () => join(app.getPath('userData'), 'config.json')

function read(): PersistedConfig {
  try {
    const path = CONFIG_PATH()
    if (!existsSync(path)) return {}
    return JSON.parse(readFileSync(path, 'utf8')) as PersistedConfig
  } catch {
    return {}
  }
}

function write(config: PersistedConfig): void {
  const path = CONFIG_PATH()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf8')
}

export function getCountry(): string {
  return read().thinqCountry ?? 'BR'
}

export function setCountry(country: string): void {
  write({ ...read(), thinqCountry: country.toUpperCase().slice(0, 2) })
}

/** Um client id estavel por instalacao, exigido pela API da LG. */
export function getClientId(): string {
  const config = read()
  if (config.clientId) return config.clientId
  const clientId = randomUUID()
  write({ ...config, clientId })
  return clientId
}

export function hasToken(): boolean {
  return Boolean(read().thinqToken)
}

export function getToken(): string | null {
  const stored = read().thinqToken
  if (!stored) return null
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    // Cofre trocou de chave (outro usuario, outra maquina): token inutil.
    return null
  }
}

export class SecureStorageUnavailable extends Error {
  constructor() {
    super('O cofre de credenciais do sistema nao esta disponivel nesta maquina.')
    this.name = 'SecureStorageUnavailable'
  }
}

export function setToken(token: string): void {
  const config = read()
  const trimmed = token.trim()

  if (!trimmed) {
    delete config.thinqToken
    write(config)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SecureStorageUnavailable()
  }
  write({ ...config, thinqToken: safeStorage.encryptString(trimmed).toString('base64') })
}

// ── Tuya Cloud ──────────────────────────────────────────────────────────────

export function getTuyaRegion(): string {
  return read().tuyaRegion ?? 'us'
}

export function setTuyaRegion(region: string): void {
  tuyaEndpoint(region)
  write({ ...read(), tuyaRegion: region })
}

export function hasTuyaCredentials(): boolean {
  return getTuyaCredentials() !== null
}

export function getTuyaCredentials(): TuyaCredentials | null {
  const stored = read().tuyaCreds
  if (!stored) return null
  try {
    const plain = safeStorage.decryptString(Buffer.from(stored, 'base64'))
    const parsed = JSON.parse(plain) as TuyaCredentials
    return parsed.accessId && parsed.accessSecret ? parsed : null
  } catch {
    return null
  }
}

export function setTuyaCredentials(creds: TuyaCredentials | null): void {
  saveTuyaConfiguration(creds, getTuyaRegion())
}

/** Grava região e credenciais juntas, depois da validação da conexão. */
export function saveTuyaConfiguration(creds: TuyaCredentials | null, region: string): void {
  tuyaEndpoint(region)
  const config = read()
  config.tuyaRegion = region
  if (!creds || !creds.accessId.trim() || !creds.accessSecret.trim()) {
    delete config.tuyaCreds
    delete config.tuyaSession
    write(config)
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SecureStorageUnavailable()
  }
  const plain = JSON.stringify({
    accessId: creds.accessId.trim(),
    accessSecret: creds.accessSecret.trim()
  })
  delete config.tuyaSession
  write({ ...config, tuyaCreds: safeStorage.encryptString(plain).toString('base64') })
}

export function getTuyaSession(): TuyaSharingSession | null {
  const encrypted = read().tuyaSession
  if (!encrypted) return null
  try {
    const value = JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))) as TuyaSharingSession
    const fields = [value.userCode, value.terminalId, value.token?.accessToken, value.token?.refreshToken, value.token?.uid]
    if (fields.some((field) => typeof field !== 'string' || !field) || !Number.isFinite(value.token?.expiresAt)) return null
    assertTuyaSharingEndpoint(value.endpoint)
    return value
  } catch { return null }
}

export function hasTuyaConnection(): boolean {
  return getTuyaSession() !== null || hasTuyaCredentials()
}

/** Uma gravação só; falhas de criptografia preservam a conexão anterior e a LG. */
export function setTuyaSession(session: TuyaSharingSession | null): void {
  const config = read()
  if (!session) {
    delete config.tuyaSession
    delete config.tuyaCreds
    write(config)
    return
  }
  assertTuyaSharingEndpoint(session.endpoint)
  if (!safeStorage.isEncryptionAvailable()) throw new SecureStorageUnavailable()
  const encrypted = safeStorage.encryptString(JSON.stringify(session)).toString('base64')
  delete config.tuyaCreds
  write({ ...config, tuyaSession: encrypted })
}
