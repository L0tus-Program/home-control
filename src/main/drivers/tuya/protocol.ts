import { createCipheriv, createDecipheriv } from 'node:crypto'
import { Socket } from 'node:net'
import { DriverError } from '../types'

/**
 * Protocolo local da Tuya, versão 3.3 (a que as lâmpadas da rede anunciam).
 *
 * Fala direto com o aparelho na porta 6668, sem nuvem. O enquadramento é
 * público e estável; a única parte secreta é a localKey de cada aparelho,
 * que entra como parâmetro.
 *
 * Quadro: 55AA | seq(4) | comando(4) | tamanho(4) | [carga] | crc32(4) | AA55
 * Em 3.3 a carga é AES-128-ECB com a localKey. Comandos de escrita levam um
 * cabeçalho de versão ("3.3" + 12 zeros) antes da carga cifrada; o DP_QUERY
 * não leva.
 */

const PREFIX = 0x000055aa
const SUFFIX = 0x0000aa55

export const Command = {
  DP_QUERY: 0x0a,
  CONTROL: 0x07
} as const

/** Comandos cuja carga NÃO recebe o cabeçalho de versão em 3.3. */
const NO_VERSION_HEADER = new Set<number>([Command.DP_QUERY])
const VERSION_HEADER = Buffer.concat([Buffer.from('3.3'), Buffer.alloc(12)])

/** Tabela CRC32 (mesmo polinômio do zlib) montada uma vez. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function encrypt(data: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null)
  return Buffer.concat([cipher.update(data), cipher.final()])
}

function decrypt(data: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  return Buffer.concat([decipher.update(data), decipher.final()])
}

function encode(seq: number, command: number, json: unknown, key: Buffer): Buffer {
  const plain = Buffer.from(JSON.stringify(json), 'utf8')
  let payload = encrypt(plain, key)
  if (!NO_VERSION_HEADER.has(command)) {
    payload = Buffer.concat([VERSION_HEADER, payload])
  }

  const length = payload.length + 8 // + crc(4) + suffix(4)
  const head = Buffer.alloc(16)
  head.writeUInt32BE(PREFIX, 0)
  head.writeUInt32BE(seq, 4)
  head.writeUInt32BE(command, 8)
  head.writeUInt32BE(length, 12)

  const body = Buffer.concat([head, payload])
  const tail = Buffer.alloc(8)
  tail.writeUInt32BE(crc32(body), 0)
  tail.writeUInt32BE(SUFFIX, 4)
  return Buffer.concat([body, tail])
}

/** Extrai e decifra a carga de um quadro de resposta. */
function decode(buffer: Buffer, key: Buffer): Record<string, unknown> | null {
  if (buffer.length < 20 || buffer.readUInt32BE(0) !== PREFIX) return null

  const length = buffer.readUInt32BE(12)
  // Região após o cabeçalho e antes de crc+suffix; começa com retcode(4).
  const region = buffer.subarray(16, 16 + Math.max(length - 8, 0))
  let payload = region.subarray(4) // descarta o retcode
  if (payload.length === 0) return {} // ack sem corpo (ex.: resposta de CONTROL)

  // Resposta de escrita às vezes devolve a carga com o cabeçalho de versão.
  if (payload.subarray(0, 3).toString() === '3.3') payload = payload.subarray(15)

  try {
    const plain = decrypt(payload, key).toString('utf8')
    const json = plain.slice(plain.indexOf('{'), plain.lastIndexOf('}') + 1)
    return json ? (JSON.parse(json) as Record<string, unknown>) : {}
  } catch {
    return null
  }
}

export interface TuyaDeviceConfig {
  id: string
  key: string
  ip: string
}

/** Uma conversa curta com o aparelho: abre, troca mensagens, fecha. */
export class TuyaConnection {
  private seq = 0

  constructor(private readonly config: TuyaDeviceConfig) {}

  private get key(): Buffer {
    return Buffer.from(this.config.key, 'utf8')
  }

  /** Lê o estado atual (os "data points"). */
  async query(): Promise<Record<string, unknown>> {
    const response = await this.exchange(Command.DP_QUERY, {
      gwId: this.config.id,
      devId: this.config.id
    })
    const dps = (response?.dps ?? {}) as Record<string, unknown>
    return dps
  }

  /** Escreve um ou mais data points. */
  async setDps(dps: Record<string, unknown>): Promise<void> {
    await this.exchange(Command.CONTROL, {
      devId: this.config.id,
      uid: this.config.id,
      t: Math.floor(Date.now() / 1000),
      dps
    })
  }

  private exchange(command: number, json: unknown): Promise<Record<string, unknown> | null> {
    return new Promise((resolve, reject) => {
      const socket = new Socket()
      const chunks: Buffer[] = []
      let settled = false

      const finish = (error: Error | null, data?: Record<string, unknown> | null): void => {
        if (settled) return
        settled = true
        socket.destroy()
        error ? reject(error) : resolve(data ?? null)
      }

      socket.setTimeout(5000)
      socket.once('timeout', () =>
        finish(new DriverError(`Aparelho ${this.config.ip} não respondeu a tempo.`))
      )
      socket.once('error', (err) =>
        finish(new DriverError(`Falha ao falar com ${this.config.ip}: ${err.message}`))
      )
      socket.once('connect', () => {
        this.seq += 1
        socket.write(encode(this.seq, command, json, this.key))
      })
      socket.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.from(chunk))
        const decoded = decode(Buffer.concat(chunks), this.key)
        if (decoded !== null) finish(null, decoded)
      })
      socket.once('close', () => finish(null, decode(Buffer.concat(chunks), this.key)))

      socket.connect(6668, this.config.ip)
    })
  }
}
