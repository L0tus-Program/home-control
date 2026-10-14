import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../shared/types'

const PORTAL = 'https://connect-pat.lgthinq.com'

interface Props {
  settings: AppSettings
  onClose: () => void
  onSaved: (settings: AppSettings) => void
}

export function SettingsModal({ settings, onClose, onSaved }: Props): React.JSX.Element {
  const [token, setToken] = useState('')
  const [country, setCountry] = useState(settings.thinq.country)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    // Campo em branco com token ja salvo significa "nao mexe no token".
    const result = await window.home.saveThinq({
      country,
      ...(token.trim() ? { token: token.trim() } : {})
    })
    setSaving(false)
    if (result.ok) {
      onSaved(result.data)
      onClose()
    } else {
      setError(result.error)
    }
  }

  const clearToken = async (): Promise<void> => {
    setSaving(true)
    const result = await window.home.saveThinq({ token: '' })
    setSaving(false)
    if (result.ok) {
      onSaved(result.data)
      setToken('')
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Preferencias"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2>Conectar a LG ThinQ</h2>
        <p>
          O token fica no cofre de credenciais do Windows, nunca em texto puro nem no codigo.
        </p>

        {error && <div className="alert">{error}</div>}

        <div className="field">
          <label htmlFor="pat">Personal Access Token</label>
          <input
            id="pat"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            placeholder={settings.thinq.hasToken ? '•••••• (token salvo)' : 'cole o PAT aqui'}
            onChange={(event) => setToken(event.target.value)}
          />
          <div className="field__hint">
            Gere em{' '}
            <a
              role="button"
              tabIndex={0}
              onClick={() => void window.home.openExternal(PORTAL)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void window.home.openExternal(PORTAL)
              }}
            >
              connect-pat.lgthinq.com
            </a>
            . A pagina abre em coreano; entre pelo login por QR code, lendo o codigo com o app
            ThinQ do celular.
          </div>
        </div>

        <div className="field">
          <label htmlFor="country">Pais da conta</label>
          <input
            id="country"
            value={country}
            maxLength={2}
            spellCheck={false}
            onChange={(event) => setCountry(event.target.value.toUpperCase())}
          />
          <div className="field__hint">
            Codigo de duas letras, o mesmo da sua conta ThinQ. Brasil e <code>BR</code>.
          </div>
        </div>

        <div className="modal__actions">
          {settings.thinq.hasToken && (
            <button
              type="button"
              className="btn btn--ghost"
              disabled={saving}
              onClick={() => void clearToken()}
            >
              Apagar token
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || (!settings.thinq.hasToken && !token.trim())}
            onClick={() => void save()}
          >
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
