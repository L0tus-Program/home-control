import { useEffect, useState } from 'react'
import { ROOM_LIMITS } from '../../../../shared/home'

interface Props {
  onCreate: (name: string) => Promise<string | null>
  onClose: () => void
}

/** Novo comodo: so o nome. Ele nasce do padrao original e sem aparelhos. */
export function NewRoomDialog({ onCreate, onClose }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <form className="modal room-new-modal" role="dialog" aria-modal="true" aria-labelledby="new-room-title"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!name.trim()) return
          setBusy(true)
          const failure = await onCreate(name)
          setBusy(false)
          if (failure) setError(failure)
        }}>
        <h2 id="new-room-title">Novo cômodo</h2>
        <p>Ele começa com a sala padrão — tamanho e móveis originais — e sem aparelhos. Depois é só editar.</p>
        <div className="field">
          <label htmlFor="new-room-name">Nome</label>
          <input id="new-room-name" autoFocus value={name} maxLength={ROOM_LIMITS.name} autoComplete="off"
            placeholder="Ex.: Quarto" disabled={busy} onChange={(event) => setName(event.target.value)} />
        </div>
        {error && <div className="alert" role="alert"><span>{error}</span></div>}
        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn--primary" disabled={busy || !name.trim()}>{busy ? 'Criando…' : 'Criar cômodo'}</button>
        </div>
      </form>
    </div>
  )
}
