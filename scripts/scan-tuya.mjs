/**
 * Varre a sub-rede atrás de aparelhos Tuya pela porta 6668.
 *
 * Complementa o discover-tuya.mjs: o broadcast só aparece de tempos em
 * tempos, mas a porta 6668 fica escutando o tempo todo.
 *
 * Uso:  node scripts/scan-tuya.mjs [prefixo]      ex: 192.168.1
 */
import { Socket } from 'node:net'

const PREFIX = process.argv[2] ?? '192.168.1'
const PORT = 6668
const TIMEOUT = 1200

function probe(host) {
  return new Promise((resolve) => {
    const socket = new Socket()
    let done = false
    const finish = (open) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(open ? host : null)
    }
    socket.setTimeout(TIMEOUT)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(PORT, host)
  })
}

const hosts = Array.from({ length: 254 }, (_, i) => `${PREFIX}.${i + 1}`)
console.log(`varrendo ${PREFIX}.1-254 na porta ${PORT}...`)

const results = await Promise.all(hosts.map(probe))
const open = results.filter(Boolean)

console.log(`\n--- ${open.length} aparelho(s) com a porta ${PORT} aberta:`)
open.forEach((host) => console.log(`   ${host}`))
if (open.length === 0) console.log('   nenhum')
