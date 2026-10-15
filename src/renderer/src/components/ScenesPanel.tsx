import { useCallback, useEffect, useRef, useState } from 'react'
import type { Scene } from '../../../shared/types'

type RunState = 'running' | 'done' | { error: string }

/** Cenas criadas no app da fabricante; daqui so da para disparar. */
export function ScenesPanel({ driverId, reload }: { driverId: string; reload: number }): React.JSX.Element | null {
  const [scenes, setScenes] = useState<Scene[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [runs, setRuns] = useState<Record<string, RunState>>({})
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(true)
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    mounted.current = true
    const pending = timers.current
    return () => {
      mounted.current = false
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    }
  }, [])

  useEffect(() => {
    let alive = true
    void window.home.listScenes().then((result) => {
      if (!alive) return
      if (result.ok) {
        setScenes(result.data.filter((scene) => scene.driverId === driverId))
        setLoadError(null)
      } else {
        setLoadError(result.error)
      }
    }, () => { if (alive) setLoadError('Não consegui carregar as cenas.') })
    return () => { alive = false }
  }, [driverId, reload, attempt])

  const run = useCallback(async (scene: Scene): Promise<void> => {
    const previous = timers.current.get(scene.id)
    if (previous) clearTimeout(previous)
    timers.current.delete(scene.id)
    setRuns((current) => ({ ...current, [scene.id]: 'running' }))
    const result = await window.home.runScene(scene.driverId, scene.id).catch(() => ({ ok: false as const, error: 'Não consegui executar a cena.' }))
    if (!mounted.current) return
    setRuns((current) => ({ ...current, [scene.id]: result.ok ? 'done' : { error: result.error } }))
    if (!result.ok) return
    timers.current.set(scene.id, setTimeout(() => {
      timers.current.delete(scene.id)
      setRuns((current) => {
        const next = { ...current }
        delete next[scene.id]
        return next
      })
    }, 3000))
  }, [])

  if (loadError && !scenes) {
    return (
      <section className="scenes" aria-label="Cenas">
        <h2 className="scenes__title">Cenas do Smart Life</h2>
        <p className="card__meta">{loadError} <button type="button" className="btn btn--ghost" onClick={() => setAttempt((n) => n + 1)}>Tentar de novo</button></p>
      </section>
    )
  }
  if (!scenes) return null
  if (scenes.length === 0) {
    // A lista vazia vem da propria Tuya: dizer isso evita parecer que o painel quebrou.
    return (
      <section className="scenes" aria-label="Cenas">
        <h2 className="scenes__title">Cenas do Smart Life</h2>
        <p className="card__meta">
          Nenhuma cena disponível. Só aparecem as cenas “Toque para executar” da conta conectada pelo QR Code; automações não aparecem aqui.{' '}
          <button type="button" className="btn btn--ghost" onClick={() => setAttempt((n) => n + 1)}>Verificar de novo</button>
        </p>
      </section>
    )
  }

  return (
    <section className="scenes" aria-label="Cenas">
      <h2 className="scenes__title">Cenas do Smart Life</h2>
      <div className="scenes__list">
        {scenes.map((scene) => {
          const state = runs[scene.id]
          const error = typeof state === 'object' ? state.error : undefined
          return (
            <button key={scene.id} type="button" className="scene" disabled={!scene.enabled || state === 'running'}
              title={error ?? (scene.enabled ? 'Executar cena' : 'Cena desativada no app')} onClick={() => void run(scene)}>
              <span className="scene__name">{scene.name}</span>
              <span className="scene__state">{state === 'running' ? 'Executando…' : state === 'done' ? 'Executada' : error ? 'Falhou' : scene.enabled ? 'Executar' : 'Desativada'}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
