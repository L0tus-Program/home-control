/**
 * Distingue câmera de lâmpada pelas portas abertas.
 *
 * Lâmpada Tuya: só 6668.
 * Câmera: costuma abrir RTSP (554), ONVIF (8000/8899) e/ou HTTP (80/443/8080).
 */
import { Socket } from 'node:net'

const HOSTS = process.argv.slice(2)
if (HOSTS.length === 0) {
  console.log('uso: node scripts/fingerprint.mjs <ip> [ip...]')
  process.exit(1)
}

const PORTS = {
  80: 'HTTP',
  443: 'HTTPS',
  554: 'RTSP (câmera)',
  1935: 'RTMP (câmera)',
  6668: 'Tuya local',
  8000: 'ONVIF/câmera',
  8080: 'HTTP alt',
  8554: 'RTSP alt (câmera)',
  8899: 'ONVIF (câmera)',
  34567: 'DVR/câmera'
}

function probe(host, port) {
  return new Promise((resolve) => {
    const socket = new Socket()
    let done = false
    const finish = (open) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(1500)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

for (const host of HOSTS) {
  const ports = Object.keys(PORTS).map(Number)
  const results = await Promise.all(ports.map((port) => probe(host, port)))
  const open = ports.filter((_, i) => results[i])

  const looksLikeCamera = open.some((p) => [554, 1935, 8000, 8554, 8899, 34567].includes(p))
  const verdict = looksLikeCamera
    ? 'CÂMERA (portas de vídeo)'
    : open.length === 1 && open[0] === 6668
      ? 'lâmpada/plug Tuya (só 6668)'
      : 'indefinido'

  console.log(`\n${host}  →  ${verdict}`)
  open.forEach((p) => console.log(`   ${p}  ${PORTS[p]}`))
  if (open.length === 0) console.log('   (nenhuma porta conhecida aberta)')
}
