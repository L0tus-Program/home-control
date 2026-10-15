import { useEffect, useState } from 'react'
import type { Scene } from '../../../shared/types'

type RunState = 'running' | 'done' | { error: string }

/** Cenas criadas no app da fabricante; daqui so da para disparar. */
export function ScenesPanel({ driverId, revision }: { driverId: string; revision: number }): React.JSX.Element | null {
  const [scenes, setScenes] = useState<Scene[] | null>(null)
  const [runs, setRuns] = useState<Record<string, RunState>>({})

  useEffect(() => {
    let alive = true
    void window.home.listScenes().then((result) => {
      if (alive) setScenes(result.ok ? result.data.filter((scene) => scene.driverId === driverId) : [])
    }, () => { if (alive) setScenes([]) })
    return () => { alive = false }
  }, [driverId, revision])

  if (!scenes || scenes.length === 0) return null

  const run = async (scene: Scene): Promise<void> => {
    setRuns((current) => ({ ...current, [scene.id]: 'running' }))
    const result = await window.home.runScene(scene.driverId, scene.id).catch(() => ({ ok: false as const, error: 'Não consegui executar a cena.' }))
    setRuns((current) => ({ ...current, [scene.id]: result.ok ? 'done' : { error: result.error } }))
    if (result.ok) setTimeout(() => setRuns((current) => {
      const next = { ...current }
      if (next[scene.id] === 'done') delete next[scene.id]
      return next
    }), 3000)
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
