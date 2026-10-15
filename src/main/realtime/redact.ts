/** Sanitizacao das capturas de diagnostico: nada que identifique a conta sai no arquivo. */

const SECRET_KEYS = /token|secret|passw|sign|cert|csr|private|local_?key|^key$|^username$|^name$|^alias$/i

/** Troca identificadores por apelidos estaveis e omite campos sensiveis. */
export class Redactor {
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
    // Do mais longo ao mais curto: um id curto nunca deixa pedaco de um longo sem mascara.
    let out = value
    for (const [secret, alias] of [...this.aliases].sort(([a], [b]) => b.length - a.length)) out = out.split(secret).join(alias)
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
