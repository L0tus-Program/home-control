import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../../../shared/types'
import type { TuyaQrCode } from '../../../shared/tuya'

const LG_PORTAL = 'https://connect-pat.lgthinq.com'

export type Integration = 'lg' | 'tuya'

interface Props {
  settings: AppSettings
  initialIntegration: Integration
  onClose: () => void
  onSaved: (settings: AppSettings) => void
}

function ExternalLink({ url, children }: { url: string; children: string }): React.JSX.Element {
  return <a href={url} onClick={(event) => { event.preventDefault(); void window.home.openExternal(url) }}>{children}</a>
}

function TuyaLogin({ settings, onClose, onSaved }: Omit<Props, 'initialIntegration'>): React.JSX.Element {
  const [userCode, setUserCode] = useState(settings.tuya.userCode ?? '')
  const [reconnecting, setReconnecting] = useState(false)
  const [qr, setQr] = useState<TuyaQrCode | null>(null)
  const [expired, setExpired] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<string | null>(null)
  const generation = useRef(0)
  const mounted = useRef(true)
  const starting = useRef(false)
  const checkNow = useRef<(() => void) | null>(null)
  const callbacks = useRef({ onClose, onSaved })
  callbacks.current = { onClose, onSaved }

  const cancel = (): void => {
    generation.current += 1
    const id = request.current
    request.current = null
    if (id) void window.home.cancelTuyaLogin(id).catch(() => undefined)
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generation.current += 1
      const id = request.current
      request.current = null
      if (id) void window.home.cancelTuyaLogin(id).catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    if (!qr) return
    let active = true
    let inFlight = false
    let next: ReturnType<typeof setTimeout> | undefined
    const isCurrent = (): boolean => active && mounted.current && request.current === qr.requestId
    const expire = (): void => {
      if (!isCurrent()) return
      setExpired(true)
      setError(null)
      request.current = null
      void window.home.cancelTuyaLogin(qr.requestId).catch(() => undefined)
    }
    const poll = async (): Promise<void> => {
      if (!isCurrent() || inFlight) return
      if (Date.now() >= qr.expiresAt) { expire(); return }
      clearTimeout(next)
      inFlight = true
      setChecking(true)
      try {
        const result = await window.home.checkTuyaLogin(qr.requestId)
        if (!isCurrent()) return
        if (!result.ok) setError(result.error)
        else if (result.data.status === 'connected') {
          request.current = null
          callbacks.current.onSaved(result.data.settings)
          callbacks.current.onClose()
          return
        } else if (result.data.status === 'expired') { expire(); return }
        else setError(null)
      } catch {
        if (isCurrent()) setError('Não foi possível verificar a autorização. Tentando novamente…')
      } finally {
        inFlight = false
        if (active && mounted.current) setChecking(false)
      }
      if (isCurrent()) next = setTimeout(() => void poll(), 3000)
    }
    checkNow.current = () => void poll()
    const expiry = setTimeout(expire, Math.max(0, qr.expiresAt - Date.now()))
    next = setTimeout(() => void poll(), 3000)
    return () => { active = false; checkNow.current = null; clearTimeout(next); clearTimeout(expiry) }
  }, [qr])

  const generate = async (): Promise<void> => {
    if (starting.current || !userCode.trim()) return
    starting.current = true
    cancel()
    const current = generation.current
    setGenerating(true)
    setQr(null)
    setExpired(false)
    setError(null)
    try {
      const result = await window.home.startTuyaLogin(userCode.trim())
      if (!mounted.current || current !== generation.current) {
        if (result.ok) void window.home.cancelTuyaLogin(result.data.requestId).catch(() => undefined)
        return
      }
      if (result.ok) {
        request.current = result.data.requestId
        setQr(result.data)
      } else setError(result.error)
    } catch {
      if (mounted.current && current === generation.current) setError('Não foi possível gerar o QR Code. Tente novamente.')
    } finally {
      starting.current = false
      if (mounted.current && current === generation.current) setGenerating(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    if (disconnecting) return
    cancel()
    setDisconnecting(true)
    setError(null)
    try {
      const result = await window.home.disconnectTuya()
      if (result.ok) {
        callbacks.current.onSaved(result.data)
        if (mounted.current) callbacks.current.onClose()
      } else if (mounted.current) setError(result.error)
    } catch {
      if (mounted.current) setError('Não foi possível desconectar. Tente novamente.')
    } finally {
      if (mounted.current) setDisconnecting(false)
    }
  }

  const connected = settings.tuya.hasCredentials && !reconnecting

  return (
    <>
      <p>Autorize pelo app Tuya Smart ou Smart Life para encontrar suas lâmpadas automaticamente.</p>
      {error && <div className="alert" role="alert">{error}</div>}
      {connected ? (
        <>
          <div className="tuya-connected" role="status"><span aria-hidden="true">✓</span><div><strong>Conta Tuya conectada</strong><p>Seus aparelhos estão disponíveis na tela Tuya.</p></div></div>
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" disabled={disconnecting} onClick={() => void disconnect()}>{disconnecting ? 'Desconectando…' : 'Desconectar'}</button>
            <button type="button" className="btn" disabled={disconnecting} onClick={() => setReconnecting(true)}>Reconectar</button>
            <button type="button" className="btn btn--primary" disabled={disconnecting} onClick={onClose}>Concluir</button>
          </div>
        </>
      ) : qr ? (
        <>
          <div className={`tuya-qr${expired ? ' tuya-qr--expired' : ''}`}>
            {!expired && <img src={qr.qrDataUrl} alt="QR Code para autorizar sua conta Tuya" width={232} height={232} />}
            <p role="status">{expired ? 'QR Code expirado. Gere outro para continuar.' : 'Aguardando sua confirmação no app…'}</p>
          </div>
          {!expired && <p className="tuya-instructions">No app, toque em <strong>+ → Escanear</strong>, leia o QR Code e confirme a autorização.</p>}
          <p className="field__hint tuya-authorization">A autorização pode aparecer como <strong>Home Assistant</strong> no app, pois usamos o mesmo protocolo público de conexão.</p>
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={() => { cancel(); setQr(null); setError(null); setChecking(false) }}>Alterar código</button>
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            {expired
              ? <button type="button" className="btn btn--primary" onClick={() => void generate()}>Gerar novo QR Code</button>
              : <button type="button" className="btn btn--primary" disabled={checking} onClick={() => checkNow.current?.()}>{checking ? 'Verificando…' : 'Já confirmei no celular'}</button>}
          </div>
        </>
      ) : (
        <form aria-busy={generating} onSubmit={(event) => { event.preventDefault(); void generate() }}>
          <div className="field">
            <label htmlFor="tuya-user-code">Código de Usuário</label>
            <input id="tuya-user-code" value={userCode} autoComplete="off" spellCheck={false} disabled={generating}
              aria-describedby="tuya-code-help" placeholder="Cole o código do seu app" onChange={(event) => setUserCode(event.target.value)} />
            <p id="tuya-code-help" className="field__hint">No app Tuya Smart ou Smart Life: Eu → Configurações → Conta e segurança → Código de Usuário.</p>
          </div>
          <p className="field__hint">Depois, basta escanear o QR Code e confirmar no celular.</p>
          <div className="modal__actions">
            <button type="button" className="btn" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn--primary" disabled={generating || !userCode.trim()}>{generating ? 'Gerando QR Code…' : 'Gerar QR Code'}</button>
          </div>
        </form>
      )}
    </>
  )
}

export function SettingsModal({ settings, initialIntegration, onClose, onSaved }: Props): React.JSX.Element {
  const tab = initialIntegration
  const [token, setToken] = useState('')
  const [country, setCountry] = useState(settings.thinq.country)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const busy = useRef(false)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy.current) onClose()
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary') ?? []).filter((element) => element.getClientRects().length > 0)
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy.current) return
    busy.current = true
    setSaving(true)
    setError(null)
    setNotice(null)
    try { await action() }
    catch { setError('Não foi possível salvar a integração. Tente novamente.') }
    finally { busy.current = false; setSaving(false) }
  }

  const save = (): void => {
    void run(async () => {
      const result = await window.home.saveThinq({ country, ...(token.trim() ? { token: token.trim() } : {}) })
      if (result.ok) { onSaved(result.data); onClose() }
      else setError(result.error)
    })
  }

  const disconnect = (): void => {
    void run(async () => {
      const result = await window.home.saveThinq({ token: '' })
      if (result.ok) {
        onSaved(result.data)
        setToken('')
        setNotice('Integração desconectada deste computador.')
      } else setError(result.error)
    })
  }

  const canSave = /^[A-Z]{2}$/.test(country) && (settings.thinq.hasToken || !!token.trim())

  return (
    <div className="overlay" onMouseDown={() => { if (!busy.current) onClose() }} role="presentation">
      <div className="modal" ref={dialog} tabIndex={-1} role="dialog" aria-modal="true"
        aria-labelledby="settings-title" aria-busy={saving} onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="settings-title">{tab === 'tuya' ? 'Conectar Tuya' : 'Conectar LG ThinQ'}</h2>
        {tab === 'tuya' ? <TuyaLogin settings={settings} onClose={onClose} onSaved={onSaved} /> : (
          <>
            <p>Conecte seu ar-condicionado pela API oficial ThinQ Connect.</p>
            {error && <div className="alert" role="alert">{error}</div>}
            {notice && <p className="modal__notice" role="status">{notice}</p>}
            <form onSubmit={(event) => { event.preventDefault(); if (canSave) save() }}>
              <fieldset disabled={saving}>
                <div className="field">
                  <label htmlFor="pat">Token de acesso (PAT)</label>
                  <input id="pat" type="password" autoComplete="new-password" spellCheck={false} value={token}
                    placeholder={settings.thinq.hasToken ? 'Token salvo' : 'Cole seu token LG'}
                    onChange={(event) => setToken(event.target.value)} />
                  <p className="field__hint">{settings.thinq.hasToken ? 'Deixe vazio para manter o token salvo.' : 'O token é salvo criptografado neste computador.'}</p>
                </div>
                <div className="field">
                  <label htmlFor="country">País da conta</label>
                  <input id="country" value={country} maxLength={2} spellCheck={false}
                    pattern="[A-Z]{2}" required onChange={(event) => setCountry(event.target.value.toUpperCase())} />
                  <p className="field__hint">Código de duas letras. Brasil: BR.</p>
                </div>
                <details className="setup-help">
                  <summary>Como gerar o token LG?</summary>
                  <p>Abra <ExternalLink url={LG_PORTAL}>connect-pat.lgthinq.com</ExternalLink>, entre com o QR code pelo app ThinQ e use CREATE NEW TOKEN. Copie o token e cole acima.</p>
                </details>
                <div className="modal__actions">
                  {settings.thinq.hasToken && <button type="button" className="btn btn--ghost" onClick={disconnect}>Desconectar</button>}
                  <button type="button" className="btn" onClick={onClose}>Cancelar</button>
                  <button type="submit" className="btn btn--primary" disabled={!canSave}>{saving ? 'Salvando…' : 'Salvar'}</button>
                </div>
              </fieldset>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
