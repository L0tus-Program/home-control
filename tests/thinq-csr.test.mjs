import test from 'node:test'
import assert from 'node:assert/strict'
import { createPrivateKey, createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { loadSource } from './load-source.mjs'

const { createCsr, buildCsr } = await loadSource('src/main/drivers/thinq/csr.ts')

/** Leitor DER minimo: devolve [tag, conteudo, total] a partir de `offset`. */
function readTlv(bytes, offset = 0) {
  const tag = bytes[offset]
  let size = bytes[offset + 1]
  let header = 2
  if (size & 0x80) {
    const count = size & 0x7f
    size = 0
    for (let i = 0; i < count; i++) size = (size << 8) | bytes[offset + 2 + i]
    header += count
  }
  return { tag, content: bytes.subarray(offset + header, offset + header + size), total: header + size, start: offset }
}

test('gera um CSR PKCS#10 com CN lg_thinq assinado pela chave gerada', async () => {
  const { csr, privateKeyPem } = await createCsr()
  assert.match(csr, /^[A-Za-z0-9+/]+=*$/, 'base64 sem cabecalho nem quebras')
  const der = Buffer.from(csr, 'base64')

  const outer = readTlv(der)
  assert.equal(outer.tag, 0x30)
  assert.equal(outer.total, der.length)
  const info = readTlv(outer.content)
  const algorithm = readTlv(outer.content, info.total)
  const signature = readTlv(outer.content, info.total + algorithm.total)
  assert.equal(signature.tag, 0x03)

  const infoDer = outer.content.subarray(0, info.total)
  assert.ok(infoDer.includes(Buffer.from('lg_thinq')))
  // OID sha512WithRSAEncryption.
  assert.ok(algorithm.content.includes(Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0d])))

  const publicKey = createPublicKey(createPrivateKey(privateKeyPem))
  assert.equal(verify('sha512', infoDer, publicKey, signature.content.subarray(1)), true)
  assert.match(privateKeyPem, /^-----BEGIN PRIVATE KEY-----/)
})

test('cada CSR usa uma chave nova', async () => {
  assert.notEqual((await createCsr()).privateKeyPem, (await createCsr()).privateKeyPem)
})

test('recusa chave que nao e RSA', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  assert.throws(() => buildCsr(privateKey, publicKey, 'x'), /RSA/)
})
