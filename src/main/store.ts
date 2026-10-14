import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
