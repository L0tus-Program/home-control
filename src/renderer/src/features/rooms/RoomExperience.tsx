import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deviceKey } from '../../../../shared/devices'
import {
  ASSET_CATALOG,
  GRID_STEP,
  addFurniture,
  deleteRoom,
  deviceRefKey,
  findDevice,
  findRoom,
  isAssetId,
  isDeviceAsset,
  removeItem,
  rotateItem,
  updateItem,
  wallOf,
  type FurnitureAssetId,
  type HomeLayout,
  type RoomItem,
  type Vec3
} from '../../../../shared/home'
import type { Command, Device, DeviceKind } from '../../../../shared/types'
import { DeviceControlModal } from '../../components/DeviceControlModal'
import { EditIcon, RefreshIcon, SettingsIcon } from '../../components/Icons'
import { modeLabel } from '../../labels'
import { RoomScene, type ItemMove } from './components/RoomScene'
import { RoomEditor } from './RoomEditor'

interface Props {
  layout: HomeLayout | null
  roomId: string | null
  onCommitLayout: (next: HomeLayout) => Promise<string | null>
  onEditingChange: (editing: boolean) => void
  devices: Device[]
  loading: boolean
  pending: ReadonlySet<string>
  error: string | null
  connected: boolean
  onRefresh: () => void
  onOpenSettings: () => void
  onCommand: (device: Device, command: Command) => void
}

interface RoomDevice {
  key: string
  item: RoomItem
  /** O aparelho carregado (com o apelido local) ou um marcador apagado. */
  device: Device
  available: boolean
}

/** Aparelho do layout que nao veio da conta: fica no lugar, apagado. */
function placeholder(item: RoomItem): Device {
  return {
    id: item.device!.deviceId,
    driverId: item.device!.driverId,
    name: item.alias ?? 'Aparelho indisponível',
    kind: (ASSET_CATALOG[item.assetId] as { deviceKind?: DeviceKind }).deviceKind ?? 'unknown',
    capabilities: [],
    state: { online: false, power: false }
  }
}

function deviceStatus(entry: { device: Device; available: boolean }, loading: boolean): string {
  const { device } = entry
  if (!entry.available) return loading ? 'Carregando…' : 'Indisponível'
  if (device.driverId === 'tuya' && !device.state.online) return 'Offline'
  if (!device.state.power) return 'Desligado'
  if (device.kind === 'air-conditioner') {
    const temp = device.state.temperature ? ` · ${Math.round(device.state.temperature)}°C` : ''
    return `${device.state.mode ? modeLabel(device.state.mode) : 'Ligado'}${temp}`
  }
  if (device.kind === 'light') return `${Math.round(device.state.brightness ?? 100)}%`
  return 'Ligado'
}

const sameItem = (a: RoomItem | undefined, b: RoomItem | undefined): boolean =>
  !!a && !!b && a.rotationY === b.rotationY && a.position.every((value, i) => value === b.position[i])

export function RoomExperience({
  layout, roomId, onCommitLayout, onEditingChange,
  devices, loading, pending, error, connected, onRefresh, onOpenSettings, onCommand
}: Props): React.JSX.Element {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<HomeLayout | null>(null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  // Abre o primeiro aparelho so na primeira carga, nao a cada comodo que ganha aparelhos.
  const autoSelected = useRef(false)

  const editing = draft !== null
  const shown = draft ?? layout
  const room = shown && roomId ? findRoom(shown, roomId) : undefined
  const roomName = room?.name ?? 'Sala viva'

  const loaded = useMemo(() => new Map(devices.map((device) => [deviceKey(device), device])), [devices])

  const roomDevices: RoomDevice[] = useMemo(() => (room?.items ?? []).flatMap((item) => {
    if (!item.device) return []
    const key = deviceRefKey(item.device)
    const device = loaded.get(key)
    return [{
      key,
      item,
      device: device ? (item.alias ? { ...device, name: item.alias } : device) : placeholder(item),
      available: !!device
    }]
  }), [room, loaded])
  const sceneDevices = useMemo(() => new Map(roomDevices.map((entry) => [entry.key, entry.device])), [roomDevices])

  // Conectados que nao estao em nenhum comodo: aparecem como "Sem comodo".
  const withoutRoom = shown ? devices.filter((device) => !findDevice(shown, deviceKey(device))) : []

  const selectedEntry = selectedKey ? roomDevices.find((entry) => entry.key === selectedKey) : undefined
  const selectedDevice = selectedEntry?.available ? selectedEntry.device : undefined
  const available = roomDevices.filter((entry) => entry.available)
  const onlineCount = available.filter((entry) => entry.device.driverId !== 'tuya' || entry.device.state.online).length
  const onCount = available.filter((entry) => entry.device.state.power).length
  const ambientTemp = available.find((entry) => entry.device.kind === 'air-conditioner' && entry.device.state.currentTemperature !== undefined)?.device.state.currentTemperature

  // Trocar de comodo fecha o que estava aberto no anterior (declarado antes da
  // selecao automatica, que pode reabrir o primeiro aparelho do novo comodo).
  useEffect(() => {
    setSelectedKey(null)
    setSelectedItemId(null)
  }, [roomId])

  useEffect(() => {
    if (editing || autoSelected.current || !available.length) return
    autoSelected.current = true
    setSelectedKey(available[0].key)
  }, [available, editing])

  useEffect(() => {
    if (selectedKey && !selectedEntry?.available) setSelectedKey(null)
  }, [selectedEntry, selectedKey])

  const setEditing = useCallback((next: HomeLayout | null) => {
    setDraft(next)
    setSelectedItemId(null)
    setEditError(null)
    onEditingChange(next !== null)
  }, [onEditingChange])

  const startEdit = (): void => {
    if (!layout) return
    setSelectedKey(null)
    setEditing(layout)
  }

  const save = async (next: HomeLayout): Promise<void> => {
    setSaving(true)
    const failure = await onCommitLayout(next)
    setSaving(false)
    if (failure) setEditError(failure)
    else setEditing(null)
  }

  const moveItem = useCallback((id: string, move: ItemMove) => {
    if (!roomId) return
    setDraft((current) => {
      if (!current) return current
      const next = updateItem(current, roomId, id, move)
      const before = findRoom(current, roomId)?.items.find((item) => item.id === id)
      const after = findRoom(next, roomId)?.items.find((item) => item.id === id)
      return sameItem(before, after) ? current : next
    })
  }, [roomId])

  // Teclado no editor: setas movem, R gira, Delete remove, Esc solta a selecao.
  useEffect(() => {
    if (!editing || !roomId) return
    const onKey = (event: KeyboardEvent): void => {
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (!selectedItemId) return
      const item = draft && findRoom(draft, roomId)?.items.find((candidate) => candidate.id === selectedItemId)
      if (!item) return
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
      if (step) {
        event.preventDefault()
        let [dx, dz] = step.map((value) => value * GRID_STEP)
        // Na parede, qualquer seta desliza ao longo dela.
        if (item.attachment === 'wall') [dx, dz] = wallOf(item) === 'left' ? [0, dx + dz] : [dx + dz, 0]
        moveItem(item.id, { position: [item.position[0] + dx, item.position[1], item.position[2] + dz] })
      } else if (event.key === 'r' || event.key === 'R') {
        event.preventDefault()
        setDraft((current) => current && rotateItem(current, roomId, item.id, event.shiftKey ? -1 : 1))
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        setDraft((current) => current && removeItem(current, roomId, item.id))
        setSelectedItemId(null)
      } else if (event.key === 'Escape') {
        setSelectedItemId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, roomId, selectedItemId, draft, moveItem])

  // Soltar da paleta e um evento isolado: parte do rascunho mais recente.
  const draftRef = useRef(draft)
  draftRef.current = draft
  const dropAsset = useCallback((assetId: string, position: Vec3) => {
    const current = draftRef.current
    if (!current || !roomId || !isAssetId(assetId) || isDeviceAsset(assetId)) return
    const result = addFurniture(current, roomId, assetId as FurnitureAssetId, { position })
    setDraft(result.layout)
    if (result.itemId) setSelectedItemId(result.itemId)
  }, [roomId])

  const edit = useMemo(() => (editing
    ? { selectedItemId, onSelectItem: setSelectedItemId, onMoveItem: moveItem, onDropAsset: dropAsset }
    : undefined), [editing, selectedItemId, moveItem, dropAsset])

  return (
    <section className="rooms-page" aria-label="Cômodo 3D">
      <div className="rooms-hero">
        <div>
          <div className="content__integration">Cômodos 3D</div>
          <h1>{roomName}</h1>
          <p>{editing
            ? 'Arraste móveis e aparelhos pela maquete. Nada é enviado aos aparelhos enquanto você edita.'
            : 'Explore sua casa em 3D. Clique em lâmpadas e ar-condicionado para controlar tudo em tempo real.'}</p>
        </div>
        {!editing && (
          <div className="rooms-hero__actions">
            <button type="button" className="btn btn--ghost" disabled={loading || !connected} onClick={onRefresh}>
              <RefreshIcon />{loading ? 'Atualizando…' : 'Atualizar casa'}
            </button>
            <button type="button" className="btn" disabled={!room} onClick={startEdit}>
              <EditIcon />Editar cômodo
            </button>
            <button type="button" className="btn btn--primary" onClick={onOpenSettings}>
              <SettingsIcon size={15} />Preferências
            </button>
          </div>
        )}
      </div>

      {error && !editing && (
        <div className="alert room-alert" role="alert">
          <span>{error}</span>
        </div>
      )}

      <div className={`room-layout room-layout--3d${editing ? ' room-layout--editing' : ''}`}>
        <div className="room-stage-card room-stage-card--3d">
          <div className="room-stage-card__meta">
            <div>
              <span className="modal__kicker">
                <span>{editing ? 'Modo edição' : 'Casa conectada'}</span>
                <span>{connected ? `${onlineCount}/${roomDevices.length} disponíveis` : 'Integrações pendentes'}</span>
              </span>
              <h2>{roomName}</h2>
              <p>{roomDevices.length ? `${roomDevices.length} ${roomDevices.length === 1 ? 'aparelho' : 'aparelhos'} · ${onCount} ${onCount === 1 ? 'ligado' : 'ligados'}` : connected ? 'Nenhum aparelho neste cômodo ainda.' : 'Conecte LG e Tuya para povoar o cômodo.'}</p>
            </div>
            <div className="room-weather" aria-label="Temperatura ambiente">
              <strong>{ambientTemp !== undefined ? `${Math.round(ambientTemp)}°C` : '—'}</strong>
              <span>ambiente</span>
            </div>
          </div>

          {/* Espera o layout local (milissegundos) para nao piscar a sala padrao. */}
          {room ? (
            <div className="room-canvas-slot">
              <RoomScene key={room.id} room={room} devices={sceneDevices} selectedKey={selectedKey}
                onSelect={setSelectedKey} edit={edit} />
              {editing && (
                <div className="room-canvas-toolbar" aria-hidden="true">
                  <div className="room-canvas-hint">
                    <span>Arraste para mover</span>
                    <span>Setas ajustam · R gira · Delete remove</span>
                  </div>
                </div>
              )}
            </div>
          ) : <div className="room-canvas-wrap" />}
        </div>

        {editing && draft && room ? (
          <RoomEditor layout={draft} room={room} devices={devices} selectedItemId={selectedItemId}
            saving={saving} error={editError} onChange={setDraft} onSelectItem={setSelectedItemId}
            onSave={() => void save(draft)} onCancel={() => setEditing(null)}
            onDeleteRoom={() => void save(deleteRoom(draft, room.id))} />
        ) : (
          <aside className="room-panel" aria-label="Aparelhos do cômodo">
            <div className="room-panel__head">
              <div>
                <span className="content__integration">Dispositivos</span>
                <h3>Toque para controlar</h3>
              </div>
              <span>{roomDevices.length}</span>
            </div>
            <div className="room-device-list">
              {roomDevices.map((entry) => (
                <button key={entry.key} type="button" disabled={!entry.available}
                  className={selectedKey === entry.key ? 'is-selected' : undefined}
                  onClick={() => setSelectedKey(selectedKey === entry.key ? null : entry.key)}>
                  <span className={`device-dot device-dot--${entry.device.kind}${entry.device.state.power ? ' is-on' : ''}`} />
                  <span>
                    <strong>{entry.device.name}</strong>
                    <small>{deviceStatus(entry, loading)}</small>
                  </span>
                </button>
              ))}
              {!roomDevices.length && (
                <p className="room-panel__empty">Nenhum aparelho neste cômodo. Use <strong>Editar cômodo</strong> para trazer aparelhos.</p>
              )}
            </div>
            {withoutRoom.length > 0 && (
              <div className="room-unassigned">
                <span className="content__integration">Sem cômodo</span>
                <ul>
                  {withoutRoom.map((device) => <li key={deviceKey(device)}>{device.name}</li>)}
                </ul>
                <p className="room-panel__empty">Edite um cômodo para posicioná-los.</p>
              </div>
            )}
          </aside>
        )}
      </div>

      {selectedDevice && !editing && (
        <DeviceControlModal
          device={selectedDevice}
          busy={pending.has(deviceKey(selectedDevice))}
          onClose={() => setSelectedKey(null)}
          onCommand={(command) => onCommand(loaded.get(deviceKey(selectedDevice)) ?? selectedDevice, command)}
        />
      )}
    </section>
  )
}
