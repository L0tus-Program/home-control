/** Erro do tempo real com texto pensado para a UI. */
export class RealtimeError extends Error {
  override name = 'RealtimeError'
}

/**
 * Endereco de broker recebido da nuvem: so com TLS e so no dominio esperado.
 * Usuario, senha e certificado nunca seguem para outro lugar.
 */
export function secureBrokerUrl(raw: unknown, allowed: readonly (string | RegExp)[]): string {
  if (typeof raw !== 'string' || !raw) throw new RealtimeError('Endereço de tempo real ausente.')
  let url: URL
  try { url = new URL(raw) } catch { throw new RealtimeError('Endereço de tempo real inválido.') }
  if (url.protocol !== 'ssl:' && url.protocol !== 'mqtts:') throw new RealtimeError('Endereço de tempo real sem TLS recusado.')
  const host = url.hostname.toLowerCase()
  const matches = (rule: string | RegExp): boolean => typeof rule === 'string' ? host.endsWith(rule) : rule.test(host)
  if (url.username || url.password || !allowed.some(matches)) {
    throw new RealtimeError('Endereço de tempo real fora do domínio oficial recusado.')
  }
  const port = url.port ? Number(url.port) : 8883
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new RealtimeError('Porta de tempo real inválida.')
  return `mqtts://${host}:${port}`
}

/** AWS IoT (`<id>-ats.iot.<regiao>.amazonaws.com`), devolvido pelo `GET route` da ThinQ Connect. */
export const LG_BROKER_DOMAINS = [/^[a-z0-9-]+\.iot\.[a-z0-9-]+\.amazonaws\.com$/] as const

/** Datacenters Tuya, os mesmos das APIs oficiais. */
export const TUYA_BROKER_DOMAINS = ['.tuyaus.com', '.tuyaeu.com', '.tuyacn.com', '.tuyain.com', '.iotbing.com'] as const
