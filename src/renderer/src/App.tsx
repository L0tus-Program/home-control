import { useCallback, useEffect, useState } from 'react'
import type { AppSettings } from '../../shared/types'
import { DeviceCard } from './components/DeviceCard'
import { RefreshIcon, SettingsIcon } from './components/Icons'
import { SettingsModal } from './components/SettingsModal'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { useDevices } from './hooks/useDevices'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 6) return 'Boa madrugada'
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

function Onboarding({ onOpen }: { onOpen: () => void }): React.JSX.Element {
  return (
    <div className="panel">
      <h2>Vamos conectar sua casa</h2>
      <p>
        O Home Control fala com o ar-condicionado pela API oficial ThinQ Connect — a mesma nuvem do
        app no celular. Falta so o token.
      </p>
      <ol>
        <li>
          Abra <code>connect-pat.lgthinq.com</code>. A pagina carrega em coreano — e normal.
        </li>
        <li>
          Entre pelo <strong>login por QR code</strong>, lendo o codigo com o app ThinQ do celular.
          O login por ID e senha so aceita conta da Coreia.
        </li>
        <li>
          <code>CREATE NEW TOKEN</code>, copie o token e cole aqui. A LG mostra ele uma vez so.
        </li>
      </ol>
      <button type="button" className="btn btn--primary" onClick={onOpen}>
        <SettingsIcon size={15} />
        Colar o token
      </button>
    </div>
  )
}

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [dismissed, setDismissed] = useState<string | null>(null)

  const connected = settings?.thinq.hasToken ?? false
  const { devices, statuses, loading, pending, error, refresh, send } = useDevices(connected)

  useEffect(() => {
    void window.home.getSettings().then((result) => {
      if (result.ok) setSettings(result.data)
    })
  }, [])

  const onSaved = useCallback((next: AppSettings) => {
    setSettings(next)
    setDismissed(null)
  }, [])

  // Carregando a configuracao: segura a tela para nao piscar o onboarding.
  if (!settings) return <div className="shell" />

  const visibleError = error && error !== dismissed ? error : null

  return (
    <>
      <div className="aurora">
        <span />
        <span />
        <span />
      </div>

      <div className="shell">
        <TitleBar />

        <div className="body">
          <Sidebar
            statuses={
              statuses.length > 0
                ? statuses
                : [{ id: 'thinq', label: 'LG ThinQ', configured: connected }]
            }
            devices={devices}
            onOpenSettings={() => setShowSettings(true)}
          />

          <main className="content">
            <div className="content__head">
              <div>
                <h1>{greeting()}, Felipe</h1>
                <p>
                  {connected
                    ? devices.length > 0
                      ? `${devices.length} ${devices.length === 1 ? 'aparelho' : 'aparelhos'} na sua casa`
                      : 'Nenhum aparelho encontrado nesta conta'
                    : 'Conecte uma integracao para comecar'}
                </p>
              </div>

              {connected && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={loading}
                  onClick={() => void refresh()}
                >
                  <RefreshIcon />
                  {loading ? 'Atualizando…' : 'Atualizar'}
                </button>
              )}
            </div>

            {visibleError && (
              <div className="alert">
                <span>{visibleError}</span>
                <button type="button" aria-label="Dispensar" onClick={() => setDismissed(error)}>
                  ✕
                </button>
              </div>
            )}

            {!connected && <Onboarding onOpen={() => setShowSettings(true)} />}

            {connected && devices.length === 0 && !loading && !visibleError && (
              <div className="panel">
                <h2>Conta conectada, nenhum aparelho</h2>
                <p>
                  A conta respondeu, mas nao listou nenhum aparelho. Se o seu ar for de uma geracao
                  antiga, ele pode estar na plataforma ThinQ legada, que esta API nao cobre.
                </p>
              </div>
            )}

            {devices.length > 0 && (
              <div className="grid">
                {devices.map((device) => (
                  <DeviceCard
                    key={device.id}
                    device={device}
                    busy={pending.has(device.id)}
                    onCommand={(command) => void send(device, command)}
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={onSaved}
        />
      )}
    </>
  )
}
