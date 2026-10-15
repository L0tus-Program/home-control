import { deviceKey } from './devices'
import type { DeviceKind } from './types'

/**
 * Layout da casa como dados: comodos, moveis e aparelhos posicionados.
 *
 * O arquivo guarda so referencias aos aparelhos (driverId + deviceId), nunca
 * tokens nem respostas dos provedores. Quem valida e grava e o processo
 * principal (`main/home-layout-store.ts`); a cena so desenha.
 */

export type Vec3 = [number, number, number]

export interface DeviceRef {
  driverId: string
  deviceId: string
}

export type Attachment = 'floor' | 'wall' | 'ceiling'

export interface RoomItem {
  id: string
  assetId: AssetId
  /** Ausente para decoracao. */
  device?: DeviceRef
  alias?: string
  attachment: Attachment
  /** Metros: x, altura y, profundidade z. Piso centrado na origem. */
  position: Vec3
  /** Radianos. */
  rotationY: number
  scale: number
}

export interface Room {
  id: string
  name: string
  /** Metros, dentro de ROOM_LIMITS. A altura e fixa (WALL_HEIGHT). */
  dimensions: { width: number; depth: number }
  items: RoomItem[]
}

export interface HomeLayout {
  schemaVersion: 1
  /** Sobe a cada gravacao; uma edicao baseada numa revisao antiga e recusada. */
  revision: number
  /** Recebe aparelhos novos; nao pode ser excluido. */
  baseRoomId: string
  rooms: Room[]
  /**
   * Aparelhos ja conhecidos que estao sem comodo por escolha do usuario.
   * Ficam aqui para nao voltarem sozinhos para o comodo base.
   */
  unassignedDevices: DeviceRef[]
  selectedRoomId?: string
}

export const HOME_LAYOUT_SCHEMA_VERSION = 1

/** Pe-direito fixo, em metros. */
export const WALL_HEIGHT = 3.4

export const ROOM_LIMITS = {
  width: { min: 5, max: 10 },
  depth: { min: 4, max: 9 },
  scale: { min: 0.5, max: 2 },
  itemsPerRoom: 200,
  rooms: 50
} as const

interface AssetSpec {
  label: string
  attachment: Attachment
  /** Presente nos aparelhos: o tipo de Device que o asset representa. */
  deviceKind?: DeviceKind
}

/**
 * Catalogo local permitido. O layout so referencia estes ids; nada de URLs,
 * modelos arbitrarios ou nomes de componente vindos do arquivo.
 */
export const ASSET_CATALOG = {
  'sofa-l': { label: 'Sofá em L', attachment: 'floor' },
  'coffee-table': { label: 'Mesa de centro', attachment: 'floor' },
  bookshelf: { label: 'Estante', attachment: 'floor' },
  plant: { label: 'Planta', attachment: 'floor' },
  rug: { label: 'Tapete', attachment: 'floor' },
  'floor-lamp': { label: 'Luminária de piso', attachment: 'floor', deviceKind: 'light' },
  'wall-ac': { label: 'Ar-condicionado', attachment: 'wall', deviceKind: 'air-conditioner' }
} as const satisfies Record<string, AssetSpec>

export type AssetId = keyof typeof ASSET_CATALOG
export type DeviceAssetId = {
  [K in AssetId]: (typeof ASSET_CATALOG)[K] extends { deviceKind: DeviceKind } ? K : never
}[AssetId]
export type FurnitureAssetId = Exclude<AssetId, DeviceAssetId>

export function isAssetId(value: unknown): value is AssetId {
  return typeof value === 'string' && Object.hasOwn(ASSET_CATALOG, value)
}

/** Asset que representa um tipo de aparelho, se houver um no catalogo. */
export function assetForDeviceKind(kind: DeviceKind): AssetId | undefined {
  return (Object.keys(ASSET_CATALOG) as AssetId[]).find(
    (id) => (ASSET_CATALOG[id] as AssetSpec).deviceKind === kind
  )
}

export function isDeviceAsset(assetId: AssetId): boolean {
  return (ASSET_CATALOG[assetId] as AssetSpec).deviceKind !== undefined
}

/** Mesma chave que `deviceKey`, para cruzar layout e aparelhos carregados. */
export function deviceRefKey(ref: DeviceRef): string {
  return deviceKey({ driverId: ref.driverId, id: ref.deviceId })
}

// ── Padrao original ────────────────────────────────────────────────────────
// Medidas e posicoes da sala padrao. Nao ficam no arquivo: cada comodo novo
// nasce daqui, mesmo que a sala base tenha sido customizada.

export const DEFAULT_DIMENSIONS = { width: 8, depth: 7 } as const

/** Faces internas das paredes: fundo (-z) e esquerda (-x). */
const BACK_WALL_Z = -DEFAULT_DIMENSIONS.depth / 2
const LEFT_WALL_X = -DEFAULT_DIMENSIONS.width / 2

/** O modelo do AC e desenhado em unidades proprias; esta escala o leva a ~1,4 m. */
export const AC_SCALE = 0.6
/** Metade da profundidade do corpo do AC ja escalado: o quanto ele sai da parede. */
const AC_HALF_DEPTH = 0.21 * AC_SCALE
const AC_HEIGHT = 2.65

/** Medidas que tambem definem onde a peca encosta na parede. */
export const SOFA_SIZE = { width: 2.4, depth: 0.95 } as const
export const BOOKSHELF_SIZE = { width: 1.6, height: 2.0, depth: 0.36 } as const

/** Pontos de luz no piso, na ordem em que as lampadas sao distribuidas. */
export const LIGHT_SPOTS: Vec3[] = [
  [-2.95, 0, BACK_WALL_Z + 0.55], // ao lado esquerdo do sofa
  [0.55, 0, BACK_WALL_Z + 0.55], // ao lado direito do sofa
  [1.5, 0, BACK_WALL_Z + 2.8], // canto do tapete
  [-3.05, 0, BACK_WALL_Z + 2.8] // ponta da chaise
]

/** Onde cada AC fica preso: parede do fundo sobre o sofa, depois parede esquerda. */
export const AC_MOUNTS: { position: Vec3; rotationY: number }[] = [
  { position: [-1.2, AC_HEIGHT, BACK_WALL_Z + AC_HALF_DEPTH], rotationY: 0 },
  { position: [LEFT_WALL_X + AC_HALF_DEPTH, AC_HEIGHT, BACK_WALL_Z + 4.8], rotationY: Math.PI / 2 }
]

const DEVICE_SLOTS: Partial<Record<AssetId, { position: Vec3; rotationY: number }[]>> = {
  'floor-lamp': LIGHT_SPOTS.map((position) => ({ position, rotationY: 0 })),
  'wall-ac': AC_MOUNTS
}

export const BASE_ROOM_ID = 'sala'

function furniture(roomId: string, assetId: AssetId, position: Vec3, rotationY = 0): RoomItem {
  return { id: `${roomId}-${assetId}`, assetId, attachment: ASSET_CATALOG[assetId].attachment, position, rotationY, scale: 1 }
}

/** A sala padrao: 8 × 7 m, sofa, mesa de centro, estante, planta e tapete, sem aparelhos. */
export function defaultRoom(id = BASE_ROOM_ID, name = 'Sala viva'): Room {
  return {
    id,
    name,
    dimensions: { ...DEFAULT_DIMENSIONS },
    items: [
      furniture(id, 'rug', [-0.9, 0, BACK_WALL_Z + 1.7]),
      // Ancora no centro do modulo encostado na parede; a chaise sai pela esquerda.
      furniture(id, 'sofa-l', [-SOFA_SIZE.width / 2, 0, BACK_WALL_Z + 0.04 + SOFA_SIZE.depth / 2]),
      furniture(id, 'coffee-table', [-0.6, 0, BACK_WALL_Z + 1.95]),
      furniture(id, 'bookshelf', [LEFT_WALL_X + BOOKSHELF_SIZE.depth / 2, 0, BACK_WALL_Z + 4.8], Math.PI / 2),
      furniture(id, 'plant', [DEFAULT_DIMENSIONS.width / 2 - 0.45, 0, BACK_WALL_Z + 0.55])
    ]
  }
}

/** Layout da primeira abertura: so o comodo base. */
export function createHomeLayout(): HomeLayout {
  const room = defaultRoom()
  return { schemaVersion: HOME_LAYOUT_SCHEMA_VERSION, revision: 0, baseRoomId: room.id, rooms: [room], unassignedDevices: [] }
}

// ── Aparelhos novos ────────────────────────────────────────────────────────

export interface DeviceCandidate extends DeviceRef {
  kind: DeviceKind
}

/** Chaves de todos os aparelhos que o layout ja conhece, com ou sem comodo. */
export function knownDeviceKeys(layout: HomeLayout): Set<string> {
  const keys = new Set(layout.unassignedDevices.map(deviceRefKey))
  for (const room of layout.rooms) {
    for (const item of room.items) if (item.device) keys.add(deviceRefKey(item.device))
  }
  return keys
}

const SAME_SPOT = 0.05

/** Ponto padrao com menos itens do mesmo asset; empate fica com o primeiro. */
function nextSlot(room: Room, assetId: AssetId): { position: Vec3; rotationY: number } | undefined {
  const slots = DEVICE_SLOTS[assetId]
  if (!slots?.length) return undefined
  const occupancy = slots.map((slot) =>
    room.items.filter((item) => item.assetId === assetId && Math.hypot(
      item.position[0] - slot.position[0], item.position[2] - slot.position[2]) < SAME_SPOT).length)
  return slots[occupancy.indexOf(Math.min(...occupancy))]
}

/**
 * Poe no comodo base os aparelhos que o layout nunca viu, na proxima posicao
 * livre do padrao. Nunca remove nem move o que ja esta posicionado, e quem
 * esta em `unassignedDevices` continua sem comodo.
 */
export function placeNewDevices(
  layout: HomeLayout,
  devices: DeviceCandidate[],
  newId: () => string = () => `item-${globalThis.crypto.randomUUID()}`
): { layout: HomeLayout; placed: number } {
  const known = knownDeviceKeys(layout)
  const baseIndex = layout.rooms.findIndex((room) => room.id === layout.baseRoomId)
  if (baseIndex < 0) return { layout, placed: 0 }
  const base: Room = { ...layout.rooms[baseIndex], items: [...layout.rooms[baseIndex].items] }
  let placed = 0

  for (const device of devices) {
    const key = deviceRefKey(device)
    const assetId = assetForDeviceKind(device.kind)
    if (known.has(key) || !assetId) continue
    const slot = nextSlot(base, assetId)
    if (!slot) continue
    known.add(key)
    base.items.push({
      id: newId(),
      assetId,
      device: { driverId: device.driverId, deviceId: device.deviceId },
      attachment: ASSET_CATALOG[assetId].attachment,
      position: [...slot.position],
      rotationY: slot.rotationY,
      scale: 1
    })
    placed++
  }

  if (!placed) return { layout, placed }
  const rooms = layout.rooms.map((room, i) => (i === baseIndex ? base : room))
  return { layout: { ...layout, rooms }, placed }
}
