/**
 * Escuta os anúncios UDP que aparelhos Tuya mandam sozinhos na LAN.
 *
 * Nada de nuvem, nada de credencial: o aparelho transmite ID, IP e versão de
 * protocolo de graça, em broadcast, a cada poucos segundos.
 *
 *   6666  protocolo 3.1, texto puro
 *   6667  protocolo 3.2+, AES-ECB com uma chave fixa publicamente conhecida
 *   7000  protocolo 3.5
 *
 * Uso:  node scripts/discover-tuya.mjs [segundos]
 */
import { createSocket } from 'node:dgram'
import { createDecipheriv, createHash } from 'node:crypto'

const SECONDS = Number(process.argv[2] ?? 60)
const PORTS = [6666, 6667, 7000]

/** Chave de broadcast que a Tuya usa em todos os aparelhos. */
const UDP_KEY = createHash('md5').update('yGAdlopoPVldABfn').digest()

const PREFIX_55AA = 0x000055aa
const PREFIX_6699 = 0x00006699

const found = new Map()

function decryptEcb(payload) {
  try {
    const decipher = createDecipheriv('aes-128-ecb', UDP_KEY, null)
    decipher.setAutoPadding(false)
    return Buffer.concat([decipher.update(payload), decipher.final()])
  } catch {
    return null
  }
}

/** O JSON às vezes vem atrás de cabeçalhos de versão; achamos ele na marra. */
function extractJson(buffer) {
  if (!buffer) return null
  const start = buffer.indexOf(0x7b) // '{'
  const end = buffer.lastIndexOf(0x7d) // '}'
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(buffer.subarray(start, end + 1).toString('utf8'))
  } catch {
    return null
  }
}

function parseFrame(message) {
  if (message.length < 20) return null
  const prefix = message.readUInt32BE(0)
  if (prefix !== PREFIX_55AA && prefix !== PREFIX_6699) return null

  // Quadro 55AA: cabeçalho de 16 bytes, depois payload, crc e sufixo.
  if (prefix === PREFIX_55AA) {
    const length = message.readUInt32BE(12)
    const payload = message.subarray(16, 16 + Math.max(length - 8, 0))

    // Quadros de resposta trazem um retcode de 4 bytes antes da carga. Sem
    // descontar ele o bloco não fecha em múltiplo de 16 e o AES recusa.
    for (const body of [payload, payload.subarray(4)]) {
      const plain = extractJson(body)
      if (plain) return plain
      if (body.length > 0 && body.length % 16 === 0) {
        const decoded = extractJson(decryptEcb(body))
        if (decoded) return decoded
      }
    }
    return null
  }
  // Quadro 6699 (3.5) é GCM; sem a chave não dá para abrir, mas o anúncio
  // em si já prova que existe um aparelho Tuya ali.
  return { _protocolo: '3.5', _observacao: 'quadro 6699, carga cifrada em GCM' }
}

function report(address, data) {
  const id = data.gwId ?? data.devId ?? data.id ?? `sem-id@${address}`
  if (found.has(id)) return
  found.set(id, { ...data, _origem: address })

  console.log(`\n● achei um aparelho  (${found.size})`)
  console.log(`   id         ${id}`)
  console.log(`   ip         ${data.ip ?? address}`)
  console.log(`   versao     ${data.version ?? data._protocolo ?? '?'}`)
  if (data.productKey) console.log(`   productKey ${data.productKey}`)
  if (data.active !== undefined) console.log(`   active     ${data.active}`)
  if (data.encrypt !== undefined) console.log(`   encrypt    ${data.encrypt}`)
  console.log(`   bruto      ${JSON.stringify(data)}`)
}

console.log(`escutando UDP ${PORTS.join(', ')} por ${SECONDS}s...`)
console.log('(se o Windows pedir permissao de firewall, aceite para rede privada)\n')

const sockets = PORTS.map((port) => {
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  socket.on('message', (message, remote) => {
    const data = parseFrame(message)
    if (data) {
      report(remote.address, data)
    } else {
      console.log(`[${port}] quadro nao reconhecido de ${remote.address}: ${
        message.subarray(0, 32).toString('hex')
      }`)
    }
  })
  socket.on('error', (error) => console.log(`[${port}] erro: ${error.message}`))
  socket.bind(port, () => socket.setBroadcast(true))
  return socket
})

setTimeout(() => {
  sockets.forEach((socket) => socket.close())
  console.log(`\n--- fim. ${found.size} aparelho(s) Tuya na rede.`)
  if (found.size === 0) {
    console.log('Nada apareceu. Pode ser firewall, rede de convidados, Wi-Fi')
    console.log('isolando clientes (AP isolation), ou o PC em sub-rede diferente.')
  }
  process.exit(0)
}, SECONDS * 1000)
