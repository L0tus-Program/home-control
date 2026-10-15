import { useState } from 'react'
import {
  ASSET_CATALOG,
  FURNITURE_ASSETS,
  FURNITURE_CATEGORIES,
  furnitureCategory,
  type FurnitureAssetId,
  type FurnitureCategory,
  type Room
} from '../../../../shared/home'
import { ASSET_DRAG_TYPE } from './dragAsset'
import { ThumbnailStudio, useFurnitureThumbnails } from './thumbnails'

interface Props {
  room: Room
  onAdd: (assetId: FurnitureAssetId) => void
}

/**
 * Paleta de moveis em grade, com miniatura de cada peca. Clicar poe no
 * centro do comodo; arrastar ate a maquete solta no ponto escolhido.
 */
export function FurniturePalette({ room, onAdd }: Props): React.JSX.Element {
  const [tab, setTab] = useState<FurnitureCategory>('sala')
  const thumbnails = useFurnitureThumbnails()
  const assets = FURNITURE_ASSETS.filter((assetId) => furnitureCategory(assetId) === tab)

  return (
    <div className="furniture-palette">
      <ThumbnailStudio />
      <div className="furniture-palette__tabs" role="tablist" aria-label="Ambiente dos móveis">
        {FURNITURE_CATEGORIES.map((category) => (
          <button key={category.id} type="button" role="tab" aria-selected={tab === category.id}
            className={tab === category.id ? 'is-active' : undefined} onClick={() => setTab(category.id)}>
            {category.label}
          </button>
        ))}
      </div>
      <div className="furniture-palette__grid" role="tabpanel">
        {assets.map((assetId) => {
          const label = ASSET_CATALOG[assetId].label
          const count = room.items.filter((item) => item.assetId === assetId).length
          const src = thumbnails.get(assetId)
          return (
            <button key={assetId} type="button" className="room-tile" draggable
              title={`${label}: clique para pôr no centro ou arraste até a maquete`}
              onClick={() => onAdd(assetId)}
              onDragStart={(event) => {
                event.dataTransfer.setData(ASSET_DRAG_TYPE, assetId)
                event.dataTransfer.effectAllowed = 'copy'
                const image = event.currentTarget.querySelector('img')
                if (image) event.dataTransfer.setDragImage(image, image.width / 2, image.height / 2)
              }}>
              <span className="room-tile__thumb">
                {src ? <img src={src} alt="" draggable={false} /> : <span className="room-tile__loading" />}
              </span>
              <span className="room-tile__label">{label}</span>
              {count > 0 && <span className="room-tile__count" aria-label={`${count} no cômodo`}>×{count}</span>}
            </button>
          )
        })}
      </div>
      <p className="field__hint">Clique para pôr no centro ou arraste até o lugar na maquete.</p>
    </div>
  )
}
