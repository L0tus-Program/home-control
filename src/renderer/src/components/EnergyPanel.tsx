import { useEffect, useState } from 'react'
import type { Device, EnergyReport } from '../../../shared/types'

/** Wh como a fabricante informa; acima de 1 kWh, em kWh com uma casa. */
export function energyLabel(wh: number): string {
  return wh >= 1000 ? `${(wh / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} kWh` : `${Math.round(wh)} Wh`
}

function weekday(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
}

/** Na abertura do app a LG pode recusar por limite de chamadas: tenta sozinho antes de mostrar o erro. */
const AUTO_RETRY_DELAYS_MS = [3000, 8000]

/** Consumo do aparelho, lido so quando o modal abre (cada leitura gasta cota da API). */
export function EnergyPanel({ device }: { device: Device }): React.JSX.Element | null {
  const supported = device.capabilities.some((cap) => cap.kind === 'energy')
  const [report, setReport] = useState<EnergyReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!supported) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setReport(null)
    setError(null)
    const load = (retry: number): void => {
      void window.home.getEnergy(device.driverId, device.id).then((result) => {
        if (!alive) return
        if (result.ok) { setReport(result.data); return }
        // "Nao informa" e definitivo; o resto pode passar sozinho em segundos.
        const definitive = /nao informa|não informa/i.test(result.error)
        if (!definitive && retry < AUTO_RETRY_DELAYS_MS.length) {
          timer = setTimeout(() => load(retry + 1), AUTO_RETRY_DELAYS_MS[retry])
          return
        }
        setError(result.error)
      }, () => { if (alive) setError('Não consegui ler o consumo agora.') })
    }
    load(0)
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [supported, device.driverId, device.id, attempt])

  if (!supported) return null
  const peak = Math.max(1, ...(report?.days.map((day) => day.wh) ?? [1]))
  return (
    <div className="control energy">
      <div className="control__label">Consumo de energia</div>
      {error && (
        <p className="card__meta">{error}{' '}
          <button type="button" className="btn btn--ghost" onClick={() => setAttempt((n) => n + 1)}>Tentar de novo</button>
        </p>
      )}
      {!report && !error && <p className="card__meta">Carregando…</p>}
      {report && (
        <>
          <div className="energy__totals">
            {report.thisMonthWh !== undefined && <div><div className="reading__label">Este mês</div><div className="reading__value">{energyLabel(report.thisMonthWh)}</div></div>}
            {report.lastMonthWh !== undefined && <div><div className="reading__label">Mês passado</div><div className="reading__value">{energyLabel(report.lastMonthWh)}</div></div>}
          </div>
          {report.days.length > 0 ? (
            <div className="energy__days" role="list" aria-label="Consumo dos últimos dias">
              {report.days.map((day) => (
                <div key={day.date} className="energy__day" role="listitem" title={`${day.date}: ${energyLabel(day.wh)}`}>
                  <div className="energy__bar" style={{ height: `${Math.max(4, (day.wh / peak) * 100)}%` }} />
                  <span>{weekday(day.date)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="card__meta">Sem consumo registrado nos últimos dias.</p>
          )}
        </>
      )}
    </div>
  )
}
