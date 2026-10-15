import { generateKeyPair, sign, type KeyObject } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * Pedido de certificado (PKCS#10) para o MQTT da ThinQ Connect.
 *
 * O `node:crypto` gera a chave e assina, mas nao monta CSR. Como o pedido da LG
 * so tem o CN, o DER cabe em poucas linhas. Mesmos parametros do SDK oficial
 * `thinqconnect`: RSA 2048, CN=lg_thinq, assinatura SHA-512 com RSA.
 */

const OID_COMMON_NAME = Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03])
// 1.2.840.113549.1.1.13 (sha512WithRSAEncryption)
const OID_SHA512_RSA = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0d])
const NULL = Buffer.from([0x05, 0x00])

function length(size: number): Buffer {
  if (size < 0x80) return Buffer.from([size])
  const bytes: number[] = []
  for (let rest = size; rest > 0; rest >>= 8) bytes.unshift(rest & 0xff)
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function tlv(tag: number, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content)
  return Buffer.concat([Buffer.from([tag]), length(body.length), body])
}

const sequence = (...content: Buffer[]): Buffer => tlv(0x30, ...content)

export interface ThinqCsr {
  /** Chave privada PKCS#8 em PEM; fica so no cofre do sistema. */
  privateKeyPem: string
  /** Corpo base64 do CSR, sem cabecalho, rodape nem quebras, como a LG espera. */
  csr: string
}

/** Assincrono: gerar RSA 2048 leva centenas de ms e nao pode travar o processo principal. */
export async function createCsr(commonName = 'lg_thinq'): Promise<ThinqCsr> {
  const { privateKey, publicKey } = await promisify(generateKeyPair)('rsa', { modulusLength: 2048, publicExponent: 65537 })
  return { privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), csr: buildCsr(privateKey, publicKey, commonName) }
}

export function buildCsr(privateKey: KeyObject, publicKey: KeyObject, commonName: string): string {
  // O OID da assinatura e fixo em RSA; outra chave geraria um CSR incoerente.
  if (privateKey.asymmetricKeyType !== 'rsa' || publicKey.asymmetricKeyType !== 'rsa') throw new Error('O CSR da LG exige chave RSA.')
  const subject = sequence(tlv(0x31, sequence(OID_COMMON_NAME, tlv(0x0c, Buffer.from(commonName, 'utf8')))))
  const info = sequence(
    tlv(0x02, Buffer.from([0x00])),
    subject,
    publicKey.export({ type: 'spki', format: 'der' }),
    // Atributos: [0] IMPLICIT SET vazio.
    Buffer.from([0xa0, 0x00])
  )
  const signature = sign('sha512', info, privateKey)
  return sequence(info, sequence(OID_SHA512_RSA, NULL), tlv(0x03, Buffer.from([0x00]), signature)).toString('base64')
}
