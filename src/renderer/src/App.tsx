import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, DriverStatus } from '../../shared/types'
import { DeviceCard } from './components/DeviceCard'
import { RefreshIcon, SettingsIcon } from './components/Icons'
import { SettingsModal, type Integration } from './components/SettingsModal'
import { Sidebar, type AppSection } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { RoomExperience } from './features/rooms/RoomExperience'
import { useDevices } from './hooks/useDevices'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 6) return 'Boa madrugada'
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

export function App(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [selectedIntegration, setSelectedIntegration] = useState<Integration>('lg')
  const [selectedSection, setSelectedSection] = useState<AppSection>('rooms')
  const [showSettings, setShowSettings] = useState(false)
  const [revision, setRevision] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const initialSelection = useRef(false)
  const isTuya = selectedIntegration === 'tuya'
  const label = isTuya ? 'Tuya' : 'LG ThinQ'
  const driverId = isTuya ? 'tuya' : 'thinq'
  const anyConnected = !!(settings?.tuya.hasCredentials || settings?.thinq.hasToken)
  const connected = !!(isTuya ? settings?.tuya.hasCredentials : settings?.thinq.hasToken)
  const roomDeviceSource = useDevices(anyConnected, revision)
  const integrationDeviceSource = useDevices(connected && selectedSection !== 'rooms', revision, driverId)
  const source = selectedSection === 'rooms' ? roomDeviceSource : integrationDeviceSource
  const { devices, statuses, loading, pending, error, refresh, send } = source
  const visibleDevices = selectedSection === 'rooms' ? devices : devices.filter((device) => device.driverId === driverId)

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true)
    setSettingsError(null)
    try {
      const result = await window.home.getSettings()
      if (result.ok) {
        setSettings(result.data)
        if (!initialSelection.current) {
          if (!result.data.thinq.hasToken && result.data.tuya.hasCredentials) setSelectedIntegration('tuya')
          initialSelection.current = true
        }
      } else setSettingsError(result.error)
    } catch {
      setSettingsError('Não foi possível carregar as preferências. Tente novamente.')
    } finally {
      setSettingsLoading(false)
    }
  }, [])

  useEffect(() => { void loadSettings() }, [loadSettings])

  const onSaved = useCallback((next: AppSettings) => {
    setSettings(next)
    setRevision((current) => current + 1)
    setDismissed(null)
  }, [])

  const visibleError = error && error !== dismissed ? error : null
  const fallbackStatuses: DriverStatus[] = settings
    ? [
        { id: 'thinq', label: 'LG ThinQ', configured: settings.thinq.hasToken },
        { id: 'tuya', label: 'Tuya', configured: settings.tuya.hasCredentials }
      ]
    : []
  const integrationStatuses: DriverStatus[] = fallbackStatuses.map((fallback) => ({
    ...fallback,
    ...statuses.find((status) => status.id === fallback.id),
    label: fallback.label,
    configured: fallback.configured
  }))

  const onSelectSection = (section: AppSection): void => {
    setSelectedSection(section)
    setDismissed(null)
    if (section === 'lg' || section === 'tuya') setSelectedIntegration(section)
  }

  return (
    <>
      <div className="aurora" aria-hidden="true"><span /><span /><span /></div>
      <div className="shell">
        <TitleBar />
        <div className="body">
          <Sidebar statuses={integrationStatuses} devices={roomDeviceSource.devices} selectedSection={selectedSection}
            selectedIntegration={selectedIntegration} onSelectSection={onSelectSection}
            onOpenSettings={() => setShowSettings(true)} />
          <main className="content" aria-busy={settingsLoading || loading}>
            {settingsError && (
              <div className="panel" role="alert">
                <h2>Não foi possível abrir sua casa</h2><p>{settingsError}</p>
                <button type="button" className="btn" onClick={() => void loadSettings()}>Tentar novamente</button>
              </div>
            )}

            {selectedSection === 'rooms' ? (
              <RoomExperience devices={visibleDevices} loading={settingsLoading || loading} pending={pending}
                error={visibleError} connected={anyConnected} onRefresh={() => { setDismissed(null); void refresh() }}
                onOpenSettings={() => setShowSettings(true)} onCommand={(device, command) => void send(device, command)} />
            ) : (
              <>
                <div className="content__head">
                  <div>
                    <div className="content__integration">{label}</div>
                    <h1>{greeting()}, Felipe</h1>
                    <p aria-live="polite">
                      {settingsLoading ? 'Carregando sua casa…' : loading && visibleDevices.length === 0
                        ? 'Buscando seus aparelhos…' : connected
                        ? `${visibleDevices.length} ${visibleDevices.length === 1 ? 'aparelho' : 'aparelhos'} ${isTuya ? 'Tuya' : 'LG'} na sua casa`
                        : `Conecte sua conta ${label} para começar`}
                    </p>
                  </div>
                  {connected && (
                    <button type="button" className="btn btn--ghost" disabled={loading}
                      onClick={() => { setDismissed(null); void refresh() }}>
                      <RefreshIcon />{loading ? 'Atualizando…' : 'Atualizar'}
                    </button>
                  )}
                </div>
                {visibleError && (
                  <div className="alert" role="alert">
                    <span>{visibleError}</span>
                    <button type="button" aria-label="Dispensar aviso" onClick={() => setDismissed(error)}>✕</button>
                  </div>
                )}
                {settings && !connected && (
                  <div className="panel">
                    <h2>{isTuya ? 'Conecte suas lâmpadas Tuya' : 'Conecte seu ar-condicionado LG'}</h2>
                    <p>{isTuya
                      ? 'Conecte pelo Código de Usuário e confirme o QR Code no app Tuya Smart ou Smart Life. Suas lâmpadas aparecem automaticamente nesta tela.'
                      : 'Controle seu ar-condicionado pela API oficial ThinQ Connect. Cole seu token de acesso para começar.'}</p>
                    <button type="button" className="btn btn--primary" onClick={() => setShowSettings(true)}>
                      <SettingsIcon size={15} />{isTuya ? 'Conectar Tuya' : 'Conectar LG ThinQ'}
                    </button>
                  </div>
                )}
                {connected && visibleDevices.length === 0 && loading && (
                  <div className="panel" role="status"><h2>Buscando seus aparelhos {label}</h2><p>Consultando sua conta…</p></div>
                )}
                {connected && visibleDevices.length === 0 && !loading && !error && (
                  <div className="panel">
                    <h2>Nenhum aparelho {label} encontrado</h2>
                    <p>{isTuya
                      ? 'Confira se suas lâmpadas aparecem na conta Tuya Smart ou Smart Life autorizada. Se necessário, reconecte a conta pelo QR Code.'
                      : 'A conta respondeu, mas não listou aparelhos. Confira se o ar-condicionado é compatível com a API ThinQ Connect.'}</p>
                    <button type="button" className="btn" onClick={() => setShowSettings(true)}>Revisar integração {label}</button>
                  </div>
                )}
                {connected && visibleDevices.length === 0 && !loading && error && (
                  <div className="panel">
                    <h2>Confira sua conexão {label}</h2>
                    <p>{isTuya ? 'Não conseguimos carregar suas lâmpadas. Tente atualizar ou reconecte a conta pelo QR Code.' : 'Não conseguimos carregar seus aparelhos. Tente atualizar ou revise as credenciais da integração.'}</p>
                    <button type="button" className="btn" onClick={() => setShowSettings(true)}>Revisar integração {label}</button>
                  </div>
                )}
                {visibleDevices.length > 0 && (
                  <div className="grid">
                    {visibleDevices.map((device) => (
                      <DeviceCard key={`${device.driverId}:${device.id}`} device={device}
                        busy={pending.has(`${device.driverId}:${device.id}`)} onCommand={(command) => void send(device, command)} />
                    ))}
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>
      {showSettings && settings && (
        <SettingsModal settings={settings} initialIntegration={selectedIntegration}
          onClose={() => setShowSettings(false)} onSaved={onSaved} />
      )}
    </>
  )
}
