import { useState } from 'react'
import {
  ASSET_CATALOG,
  FURNITURE_ASSETS,
  FURNITURE_CATEGORIES,
  ROOM_LIMITS,
  addFurniture,
  assetForDeviceKind,
  assignDevice,
  deviceRefKey,
  findDevice,
  furnitureCategory,
  removeItem,
  renameRoom,
  resetRoom,
  resizeRoom,
  rotateItem,
  updateItem,
  wallOf,
  type HomeLayout,
  type Room,
  type RoomItem
} from '../../../../shared/home'
import { deviceKey } from '../../../../shared/devices'
import type { Device } from '../../../../shared/types'
import { PlusIcon, ResetIcon, RotateIcon, TrashIcon } from '../../components/Icons'

interface Props {
  /** Rascunho da casa inteira; so vai para o disco ao salvar. */
  layout: HomeLayout
  room: Room
  /** Aparelhos carregados agora, sem apelidos. */
  devices: Device[]
  selectedItemId: string | null
  saving: boolean
  error: string | null
  onChange: (next: HomeLayout) => void
  onSelectItem: (id: string | null) => void
  onSave: () => void
  onCancel: () => void
  onDeleteRoom: () => void
}

/** Campo de texto que grava a cada tecla sem perder espacos enquanto se digita. */
function TextField({ id, label, value, placeholder, hint, onChange }: {
  id: string
  label: string
  value: string
  placeholder?: string
  hint?: string
  onChange: (value: string) => void
}) {
  const [text, setText] = useState(value)
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} value={text} maxLength={ROOM_LIMITS.name} placeholder={placeholder} autoComplete="off"
        onChange={(event) => { setText(event.target.value); onChange(event.target.value) }} />
      {hint && <p className="field__hint">{hint}</p>}
    </div>
  )
}

function Dimension({ id, label, value, min, max, onChange }: {
  id: string
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <div className="room-editor__range">
      <label htmlFor={id}>{label}<strong>{value.toFixed(2).replace('.', ',')} m</strong></label>
      <input id={id} type="range" min={min} max={max} step={0.25} value={value}
        onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  )
}

/** A confirmacao aparece onde o usuario clicou; rola o painel ate ela inteira. */
const revealConfirm = (element: HTMLDivElement | null): void => element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })

function itemTitle(item: RoomItem, devices: ReadonlyMap<string, Device>): string {
  if (!item.device) return ASSET_CATALOG[item.assetId].label
  return item.alias ?? devices.get(deviceRefKey(item.device))?.name ?? 'Aparelho indisponível'
}

export function RoomEditor({ layout, room, devices, selectedItemId, saving, error, onChange, onSelectItem, onSave, onCancel, onDeleteRoom }: Props): React.JSX.Element {
  const [confirmMove, setConfirmMove] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const loaded = new Map(devices.map((device) => [deviceKey(device), device]))
  const selected = room.items.find((item) => item.id === selectedItemId)
  const isBase = room.id === layout.baseRoomId
  const deviceItems = room.items.filter((item) => item.device)

  // Aparelhos que podem vir para este comodo: sem comodo, novos ou em outro comodo.
  const addable = devices
    .filter((device) => assetForDeviceKind(device.kind))
    .map((device) => ({ device, key: deviceKey(device), current: findDevice(layout, deviceKey(device)) }))
    .filter((entry) => entry.current?.room.id !== room.id)

  const bring = (device: Device): void => {
    const result = assignDevice(layout, room.id, { driverId: device.driverId, deviceId: device.id, kind: device.kind })
    setConfirmMove(null)
    onChange(result.layout)
    if (result.itemId) onSelectItem(result.itemId)
  }

  return (
    <aside className="room-panel room-editor-panel" aria-label="Editar cômodo">
      <div className="room-panel__head">
        <div>
          <span className="content__integration">Editando{isBase ? ' · cômodo base' : ''}</span>
          <h3>{room.name}</h3>
        </div>
      </div>

      <div className="room-editor__body">
        <TextField key={`name-${room.id}`} id="room-name" label="Nome do cômodo" value={room.name}
          onChange={(value) => onChange(renameRoom(layout, room.id, value))} />

        <section className="room-editor__section" aria-labelledby="room-size-title">
          <h4 id="room-size-title">Tamanho</h4>
          <Dimension id="room-width" label="Largura" value={room.dimensions.width}
            min={ROOM_LIMITS.width.min} max={ROOM_LIMITS.width.max}
            onChange={(width) => onChange(resizeRoom(layout, room.id, { ...room.dimensions, width }))} />
          <Dimension id="room-depth" label="Profundidade" value={room.dimensions.depth}
            min={ROOM_LIMITS.depth.min} max={ROOM_LIMITS.depth.max}
            onChange={(depth) => onChange(resizeRoom(layout, room.id, { ...room.dimensions, depth }))} />
          <p className="field__hint">As paredes ficam ao fundo e à esquerda; o que sobrar é trazido para dentro.</p>
        </section>

        {selected ? (
          <section className="room-editor__section room-editor__selected" aria-labelledby="room-selected-title">
            <h4 id="room-selected-title">{itemTitle(selected, loaded)}</h4>
            <p className="field__hint">
              {ASSET_CATALOG[selected.assetId].label}
              {selected.attachment === 'wall' ? ` · parede ${wallOf(selected) === 'left' ? 'da esquerda' : 'do fundo'}` : ''}
              {selected.device && !loaded.has(deviceRefKey(selected.device)) ? ' · indisponível na conta' : ''}
            </p>
            {selected.device && (
              <TextField key={`alias-${selected.id}`} id="item-alias" label="Nome neste cômodo" value={selected.alias ?? ''}
                placeholder={loaded.get(deviceRefKey(selected.device))?.name ?? 'Ex.: Luz do sofá'}
                hint="Só no Home Control; a conta LG/Tuya continua com o nome original."
                onChange={(alias) => onChange(updateItem(layout, room.id, selected.id, { alias }))} />
            )}
            <div className="room-editor__actions">
              <button type="button" className="btn" onClick={() => onChange(rotateItem(layout, room.id, selected.id))}>
                <RotateIcon />{selected.attachment === 'wall' ? 'Trocar de parede' : 'Girar 90°'}
              </button>
              <button type="button" className="btn btn--danger" onClick={() => {
                onChange(removeItem(layout, room.id, selected.id))
                onSelectItem(null)
              }}>
                <TrashIcon />{selected.device ? 'Remover do cômodo' : 'Remover'}
              </button>
            </div>
            <p className="field__hint">Arraste na maquete ou use as setas · R gira · Delete remove.</p>
          </section>
        ) : (
          <p className="room-editor__tip">Clique num móvel ou aparelho na maquete para mover, girar ou remover.</p>
        )}

        <section className="room-editor__section" aria-labelledby="room-devices-title">
          <h4 id="room-devices-title">Aparelhos neste cômodo</h4>
          <div className="room-editor__chips">
            {deviceItems.map((item) => (
              <button key={item.id} type="button" className={`room-chip${item.id === selectedItemId ? ' is-selected' : ''}`}
                onClick={() => onSelectItem(item.id)}>
                {itemTitle(item, loaded)}
              </button>
            ))}
            {!deviceItems.length && <span className="field__hint">Nenhum aparelho ainda.</span>}
          </div>
          {addable.length > 0 && (
            <div className="room-editor__add">
              <span className="field__hint">Trazer para cá</span>
              {addable.map(({ device, key, current }) => {
                const label = current?.item.alias ?? device.name
                if (confirmMove === key && current) {
                  return (
                    <div key={key} className="room-editor__confirm" role="group" aria-label={`Mover ${label}`}>
                      <span><strong>{label}</strong> está em {current.room.name}. Mover para {room.name}?</span>
                      <div>
                        <button type="button" className="btn btn--small" onClick={() => setConfirmMove(null)}>Cancelar</button>
                        <button type="button" className="btn btn--small btn--primary" onClick={() => bring(device)}>Mover</button>
                      </div>
                    </div>
                  )
                }
                return (
                  <button key={key} type="button" className="room-add-row" onClick={() => (current ? setConfirmMove(key) : bring(device))}>
                    <PlusIcon />
                    <span><strong>{label}</strong><small>{current ? `em ${current.room.name}` : 'sem cômodo'}</small></span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <section className="room-editor__section" aria-labelledby="room-furniture-title">
          <h4 id="room-furniture-title">Adicionar móvel</h4>
          {FURNITURE_CATEGORIES.map((category) => (
            <div key={category.id} className="room-editor__group" role="group" aria-label={category.label}>
              <span className="field__hint">{category.label}</span>
              <div className="room-editor__chips">
                {FURNITURE_ASSETS.filter((assetId) => furnitureCategory(assetId) === category.id).map((assetId) => (
                  <button key={assetId} type="button" className="room-chip" onClick={() => {
                    const result = addFurniture(layout, room.id, assetId)
                    onChange(result.layout)
                    if (result.itemId) onSelectItem(result.itemId)
                  }}>
                    <PlusIcon size={13} />{ASSET_CATALOG[assetId].label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="room-editor__section room-editor__danger">
          {confirmReset ? (
            <div ref={revealConfirm} className="room-editor__confirm" role="group" aria-label="Restaurar padrão">
              <span>Voltar <strong>{room.name}</strong> ao tamanho e aos móveis da sala padrão? Os aparelhos ficam no cômodo, nos lugares padrão. Você ainda pode cancelar a edição.</span>
              <div>
                <button type="button" className="btn btn--small" onClick={() => setConfirmReset(false)}>Voltar</button>
                <button type="button" className="btn btn--small btn--primary" onClick={() => {
                  onChange(resetRoom(layout, room.id))
                  onSelectItem(null)
                  setConfirmReset(false)
                }}>Restaurar</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn--ghost" onClick={() => setConfirmReset(true)}>
              <ResetIcon />Restaurar padrão
            </button>
          )}
          {!isBase && (confirmDelete ? (
              <div ref={revealConfirm} className="room-editor__confirm" role="group" aria-label="Excluir cômodo">
                <span>Excluir <strong>{room.name}</strong>? Os aparelhos dele ficam sem cômodo.</span>
                <div>
                  <button type="button" className="btn btn--small" onClick={() => setConfirmDelete(false)}>Voltar</button>
                  <button type="button" className="btn btn--small btn--danger" disabled={saving} onClick={onDeleteRoom}>Excluir</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn--ghost btn--danger-text" onClick={() => setConfirmDelete(true)}>
                <TrashIcon />Excluir cômodo
              </button>
            ))}
        </section>
      </div>

      {error && <div className="alert" role="alert"><span>{error}</span></div>}
      <div className="room-editor__footer">
        <button type="button" className="btn" disabled={saving} onClick={onCancel}>Cancelar</button>
        <button type="button" className="btn btn--primary" disabled={saving} onClick={onSave}>{saving ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </aside>
  )
}
