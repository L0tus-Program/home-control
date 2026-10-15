import { deviceKey } from './devices'
import type { DeviceKind } from './types'

/**
 * Layout da casa como dados: comodos, moveis e aparelhos posicionados.
 *
 * O arquivo guarda so referencias aos aparelhos (driverId + deviceId), nunca
 * tokens nem respostas dos provedores. Quem valida e grava e o processo
 * principal (`main/home-layout-store.ts`); a cena so desenha.
 *
 * As operacoes daqui sao puras: recebem um layout e devolvem outro, sem
 * mexer no original. O editor trabalha num rascunho e so grava ao salvar.
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
  /** Nome local do aparelho, sem renomear a conta do provedor. */
  alias?: string
  attachment: Attachment
  /** Metros: x, altura y, profundidade z. Piso centrado na origem. */
  position: Vec3
  /** Radianos. */
  rotationY: number
  scale: number
}

export interface RoomDimensions {
  width: number
  depth: number
}

export interface Room {
  id: string
  name: string
  /** Metros, dentro de ROOM_LIMITS. A altura e fixa (WALL_HEIGHT). */
  dimensions: RoomDimensions
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

/** Encaixe de posicao no editor, em metros. */
export const GRID_STEP = 0.25

export const ROOM_LIMITS = {
  width: { min: 5, max: 10 },
  depth: { min: 4, max: 9 },
  scale: { min: 0.5, max: 2 },
  itemsPerRoom: 200,
  rooms: 50,
  name: 60
} as const

/** Caixa da peca no piso, em metros, no referencial dela (antes de girar). */
interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type FurnitureCategory = 'sala' | 'quarto' | 'mesa'

export const FURNITURE_CATEGORIES: { id: FurnitureCategory; label: string }[] = [
  { id: 'sala', label: 'Sala' },
  { id: 'quarto', label: 'Quarto' },
  { id: 'mesa', label: 'Mesa e trabalho' }
]

interface AssetSpec {
  label: string
  attachment: Attachment
  bounds: Bounds
  /** Grupo na paleta do editor; so moveis. */
  category?: FurnitureCategory
  /** Presente nos aparelhos: o tipo de Device que o asset representa. */
  deviceKind?: DeviceKind
}

const centered = (width: number, depth: number): Bounds =>
  ({ minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 })

/** O modelo do AC e desenhado em unidades proprias; esta escala o leva a ~1,4 m. */
export const AC_SCALE = 0.6
/** Metade da profundidade do corpo do AC ja escalado: o quanto ele sai da parede. */
const AC_HALF_DEPTH = 0.21 * AC_SCALE
const AC_HALF_WIDTH = 1.15 * AC_SCALE
const AC_HEIGHT = 2.65

/** Medidas que tambem definem onde a peca encosta na parede. */
export const SOFA_SIZE = { width: 2.4, depth: 0.95, chaiseWidth: 0.85, chaiseLength: 1.6 } as const
export const BOOKSHELF_SIZE = { width: 1.6, height: 2.0, depth: 0.36 } as const

/**
 * Medidas dos demais moveis, em metros, com a frente para +z. Os modelos 3D
 * e as caixas do catalogo saem daqui, para o contorno bater com a peca.
 */
export const FURNITURE_SIZES = {
  sofa: { width: 2.1, depth: 0.92 },
  armchair: { width: 0.92, depth: 0.86 },
  bedDouble: { width: 1.6, length: 2.05, headboard: 1.72 },
  bedSingle: { width: 0.95, length: 2.0, headboard: 1.05 },
  nightstand: { width: 0.48, depth: 0.4, height: 0.52 },
  wardrobe: { width: 1.8, depth: 0.6, height: 2.2 },
  dresser: { width: 1.2, depth: 0.5, height: 0.86 },
  diningTable: { width: 1.6, depth: 0.9, height: 0.76 },
  chair: { width: 0.46, depth: 0.5 },
  desk: { width: 1.4, depth: 0.7, height: 0.75 },
  officeChair: { width: 0.66, depth: 0.66 },
  tvStand: { width: 1.8, depth: 0.42, height: 0.48 }
} as const

const F = FURNITURE_SIZES
/** Cama com a cabeceira em -z; a cabeceira e um pouco mais larga e grossa. */
const bedBounds = ({ length, headboard }: { length: number; headboard: number }): Bounds =>
  ({ minX: -headboard / 2, maxX: headboard / 2, minZ: -length / 2 - 0.06, maxZ: length / 2 })

/**
 * Catalogo local permitido. O layout so referencia estes ids; nada de URLs,
 * modelos arbitrarios ou nomes de componente vindos do arquivo.
 */
export const ASSET_CATALOG = {
  'sofa-l': {
    label: 'Sofá em L',
    attachment: 'floor',
    category: 'sala',
    // Origem no centro do modulo com encosto; a chaise avanca pela esquerda.
    bounds: { minX: -SOFA_SIZE.width / 2, maxX: SOFA_SIZE.width / 2, minZ: -SOFA_SIZE.depth / 2, maxZ: SOFA_SIZE.depth / 2 + SOFA_SIZE.chaiseLength }
  },
  sofa: { label: 'Sofá', attachment: 'floor', category: 'sala', bounds: centered(F.sofa.width, F.sofa.depth) },
  armchair: { label: 'Poltrona', attachment: 'floor', category: 'sala', bounds: centered(F.armchair.width, F.armchair.depth) },
  'coffee-table': { label: 'Mesa de centro', attachment: 'floor', category: 'sala', bounds: centered(1, 1) },
  'tv-stand': { label: 'Rack com TV', attachment: 'floor', category: 'sala', bounds: centered(F.tvStand.width, F.tvStand.depth) },
  bookshelf: { label: 'Estante', attachment: 'floor', category: 'sala', bounds: centered(BOOKSHELF_SIZE.width, BOOKSHELF_SIZE.depth) },
  plant: { label: 'Planta', attachment: 'floor', category: 'sala', bounds: centered(0.56, 0.56) },
  rug: { label: 'Tapete', attachment: 'floor', category: 'sala', bounds: centered(3.6, 2.6) },
  'bed-double': { label: 'Cama de casal', attachment: 'floor', category: 'quarto', bounds: bedBounds(F.bedDouble) },
  'bed-single': { label: 'Cama de solteiro', attachment: 'floor', category: 'quarto', bounds: bedBounds(F.bedSingle) },
  nightstand: { label: 'Criado-mudo', attachment: 'floor', category: 'quarto', bounds: centered(F.nightstand.width, F.nightstand.depth) },
  wardrobe: { label: 'Roupeiro', attachment: 'floor', category: 'quarto', bounds: centered(F.wardrobe.width, F.wardrobe.depth) },
  dresser: { label: 'Cômoda', attachment: 'floor', category: 'quarto', bounds: centered(F.dresser.width, F.dresser.depth) },
  'dining-table': { label: 'Mesa de jantar', attachment: 'floor', category: 'mesa', bounds: centered(F.diningTable.width, F.diningTable.depth) },
  chair: { label: 'Cadeira', attachment: 'floor', category: 'mesa', bounds: centered(F.chair.width, F.chair.depth) },
  desk: { label: 'Escrivaninha', attachment: 'floor', category: 'mesa', bounds: centered(F.desk.width, F.desk.depth) },
  'office-chair': { label: 'Cadeira de escritório', attachment: 'floor', category: 'mesa', bounds: centered(F.officeChair.width, F.officeChair.depth) },
  'floor-lamp': { label: 'Luminária de piso', attachment: 'floor', bounds: centered(0.8, 0.8), deviceKind: 'light' },
  'wall-ac': { label: 'Ar-condicionado', attachment: 'wall', bounds: centered(AC_HALF_WIDTH * 2, AC_HALF_DEPTH * 2), deviceKind: 'air-conditioner' }
} as const satisfies Record<string, AssetSpec>

export type AssetId = keyof typeof ASSET_CATALOG
export type DeviceAssetId = {
  [K in AssetId]: (typeof ASSET_CATALOG)[K] extends { deviceKind: DeviceKind } ? K : never
}[AssetId]
export type FurnitureAssetId = Exclude<AssetId, DeviceAssetId>

export const FURNITURE_ASSETS = (Object.keys(ASSET_CATALOG) as AssetId[])
  .filter((id): id is FurnitureAssetId => !isDeviceAsset(id))

export function furnitureCategory(assetId: FurnitureAssetId): FurnitureCategory {
  return (ASSET_CATALOG[assetId] as AssetSpec).category ?? 'sala'
}

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

// ── Geometria do comodo ────────────────────────────────────────────────────

/** Faces internas das paredes: fundo (-z) e esquerda (-x). */
export function wallsOf({ width, depth }: RoomDimensions): { backZ: number; leftX: number } {
  return { backZ: -depth / 2, leftX: -width / 2 }
}

export function snap(value: number, step = GRID_STEP): number {
  return Math.round(value / step) * step
}

const clamp = (value: number, min: number, max: number): number =>
  min > max ? (min + max) / 2 : Math.min(max, Math.max(min, value))

/** Mantem o giro em [0, 2π), dentro do que o arquivo aceita. */
export function normalizeRotation(rotation: number): number {
  const turn = Math.PI * 2
  const value = ((rotation % turn) + turn) % turn
  return Math.abs(value - turn) < 1e-9 ? 0 : value
}

/** Parede em que um item de parede esta preso, pelo giro dele. */
export function wallOf(item: Pick<RoomItem, 'rotationY'>): 'back' | 'left' {
  return Math.abs(Math.sin(item.rotationY)) > 0.5 ? 'left' : 'back'
}

/** Caixa do item no piso do comodo, ja girada e escalada. */
export function footprint(item: Pick<RoomItem, 'assetId' | 'position' | 'rotationY' | 'scale'>): Bounds {
  const b = ASSET_CATALOG[item.assetId].bounds
  const cos = Math.cos(item.rotationY)
  const sin = Math.sin(item.rotationY)
  const corners = [[b.minX, b.minZ], [b.maxX, b.minZ], [b.minX, b.maxZ], [b.maxX, b.maxZ]]
    .map(([x, z]) => [(x * cos + z * sin) * item.scale, (-x * sin + z * cos) * item.scale])
  const xs = corners.map(([x]) => x)
  const zs = corners.map(([, z]) => z)
  return {
    minX: item.position[0] + Math.min(...xs),
    maxX: item.position[0] + Math.max(...xs),
    minZ: item.position[2] + Math.min(...zs),
    maxZ: item.position[2] + Math.max(...zs)
  }
}

/**
 * Traz o item para dentro do comodo. Itens de parede continuam presos a
 * parede do fundo ou da esquerda e so deslizam ao longo dela.
 */
export function clampItem(item: RoomItem, dimensions: RoomDimensions): RoomItem {
  const { width, depth } = dimensions
  const { backZ, leftX } = wallsOf(dimensions)
  const [x, y, z] = item.position

  if (item.attachment === 'wall') {
    const half = AC_HALF_WIDTH * item.scale
    const out = AC_HALF_DEPTH * item.scale
    const height = clamp(y, 0.5, WALL_HEIGHT - 0.3)
    return wallOf(item) === 'left'
      ? { ...item, rotationY: Math.PI / 2, position: [leftX + out, height, clamp(z, backZ + half, depth / 2 - half)] }
      : { ...item, rotationY: 0, position: [clamp(x, leftX + half, width / 2 - half), height, backZ + out] }
  }

  const box = footprint(item)
  const dx = clamp(box.minX, leftX, width / 2 - (box.maxX - box.minX)) - box.minX
  const dz = clamp(box.minZ, backZ, depth / 2 - (box.maxZ - box.minZ)) - box.minZ
  // Uma peca maior que o comodo fica centrada nele, sem sair dos limites do arquivo.
  return {
    ...item,
    position: [clamp(x + dx, -width / 2, width / 2), clamp(y, 0, WALL_HEIGHT), clamp(z + dz, -depth / 2, depth / 2)]
  }
}

// ── Padrao original ────────────────────────────────────────────────────────
// Medidas e posicoes da sala padrao. Nao ficam no arquivo: cada comodo novo
// nasce daqui, mesmo que a sala base tenha sido customizada.

export const DEFAULT_DIMENSIONS: RoomDimensions = { width: 8, depth: 7 }

/**
 * Pontos padrao de cada aparelho, a partir das paredes do fundo e da
 * esquerda, na ordem em que sao ocupados.
 */
export function deviceSlots(assetId: AssetId, dimensions: RoomDimensions): { position: Vec3; rotationY: number }[] {
  const { backZ, leftX } = wallsOf(dimensions)
  if (assetId === 'floor-lamp') {
    return [
      [leftX + 1.05, backZ + 0.55], // ao lado esquerdo do sofa
      [leftX + 4.55, backZ + 0.55], // ao lado direito do sofa
      [leftX + 5.5, backZ + 2.8], // canto do tapete
      [leftX + 0.95, backZ + 2.8] // ponta da chaise
    ].map(([x, z]) => ({ position: [x, 0, z] as Vec3, rotationY: 0 }))
  }
  if (assetId === 'wall-ac') {
    // Parede do fundo sobre o sofa, depois parede esquerda.
    return [
      { position: [leftX + 2.8, AC_HEIGHT, backZ + AC_HALF_DEPTH], rotationY: 0 },
      { position: [leftX + AC_HALF_DEPTH, AC_HEIGHT, backZ + 4.8], rotationY: Math.PI / 2 }
    ]
  }
  return []
}

/** Pontos de luz da sala padrao. */
export const LIGHT_SPOTS: Vec3[] = deviceSlots('floor-lamp', DEFAULT_DIMENSIONS).map((slot) => slot.position)
/** Onde cada AC fica preso na sala padrao. */
export const AC_MOUNTS = deviceSlots('wall-ac', DEFAULT_DIMENSIONS)

export const BASE_ROOM_ID = 'sala'

/** A sala padrao: 8 × 7 m, sofa, mesa de centro, estante, planta e tapete, sem aparelhos. */
export function defaultRoom(id = BASE_ROOM_ID, name = 'Sala viva'): Room {
  const { backZ, leftX } = wallsOf(DEFAULT_DIMENSIONS)
  const furniture = (assetId: FurnitureAssetId, position: Vec3, rotationY = 0): RoomItem =>
    ({ id: `${id}-${assetId}`, assetId, attachment: ASSET_CATALOG[assetId].attachment, position, rotationY, scale: 1 })
  return {
    id,
    name,
    dimensions: { ...DEFAULT_DIMENSIONS },
    items: [
      furniture('rug', [-0.9, 0, backZ + 1.7]),
      // Ancora no centro do modulo encostado na parede; a chaise sai pela esquerda.
      furniture('sofa-l', [-SOFA_SIZE.width / 2, 0, backZ + 0.04 + SOFA_SIZE.depth / 2]),
      furniture('coffee-table', [-0.6, 0, backZ + 1.95]),
      furniture('bookshelf', [leftX + BOOKSHELF_SIZE.depth / 2, 0, backZ + 4.8], Math.PI / 2),
      furniture('plant', [DEFAULT_DIMENSIONS.width / 2 - 0.45, 0, backZ + 0.55])
    ]
  }
}

/** Layout da primeira abertura: so o comodo base. */
export function createHomeLayout(): HomeLayout {
  const room = defaultRoom()
  return { schemaVersion: HOME_LAYOUT_SCHEMA_VERSION, revision: 0, baseRoomId: room.id, rooms: [room], unassignedDevices: [] }
}

// ── Consultas ──────────────────────────────────────────────────────────────

export interface DeviceCandidate extends DeviceRef {
  kind: DeviceKind
}

const newItemId = (): string => `item-${globalThis.crypto.randomUUID()}`

/** Chaves de todos os aparelhos que o layout ja conhece, com ou sem comodo. */
export function knownDeviceKeys(layout: HomeLayout): Set<string> {
  const keys = new Set(layout.unassignedDevices.map(deviceRefKey))
  for (const room of layout.rooms) {
    for (const item of room.items) if (item.device) keys.add(deviceRefKey(item.device))
  }
  return keys
}

/** Comodo e item em que o aparelho esta, se estiver em algum. */
export function findDevice(layout: HomeLayout, key: string): { room: Room; item: RoomItem } | undefined {
  for (const room of layout.rooms) {
    const item = room.items.find((candidate) => candidate.device && deviceRefKey(candidate.device) === key)
    if (item) return { room, item }
  }
  return undefined
}

export function findRoom(layout: HomeLayout, roomId: string): Room | undefined {
  return layout.rooms.find((room) => room.id === roomId)
}

// ── Edicao ─────────────────────────────────────────────────────────────────

function mapRoom(layout: HomeLayout, roomId: string, change: (room: Room) => Room): HomeLayout {
  return { ...layout, rooms: layout.rooms.map((room) => (room.id === roomId ? change(room) : room)) }
}

const SAME_SPOT = 0.05

/** Ponto padrao com menos itens do mesmo asset; empate fica com o primeiro. */
function nextSlot(room: Room, assetId: AssetId): { position: Vec3; rotationY: number } | undefined {
  const slots = deviceSlots(assetId, room.dimensions).map((slot) =>
    clampItem({ id: '', assetId, attachment: ASSET_CATALOG[assetId].attachment, scale: 1, ...slot, position: [...slot.position] }, room.dimensions))
  if (!slots.length) return undefined
  const occupancy = slots.map((slot) =>
    room.items.filter((item) => item.assetId === assetId && Math.hypot(
      item.position[0] - slot.position[0], item.position[2] - slot.position[2]) < SAME_SPOT).length)
  const best = slots[occupancy.indexOf(Math.min(...occupancy))]
  return { position: best.position, rotationY: best.rotationY }
}

function deviceItem(room: Room, device: DeviceCandidate, id: string, alias?: string): RoomItem | undefined {
  const assetId = assetForDeviceKind(device.kind)
  const slot = assetId && nextSlot(room, assetId)
  if (!assetId || !slot) return undefined
  return {
    id,
    assetId,
    device: { driverId: device.driverId, deviceId: device.deviceId },
    ...(alias ? { alias } : {}),
    attachment: ASSET_CATALOG[assetId].attachment,
    position: slot.position,
    rotationY: slot.rotationY,
    scale: 1
  }
}

/**
 * Poe no comodo base os aparelhos que o layout nunca viu, na proxima posicao
 * livre do padrao. Nunca remove nem move o que ja esta posicionado, e quem
 * esta em `unassignedDevices` continua sem comodo.
 */
export function placeNewDevices(
  layout: HomeLayout,
  devices: DeviceCandidate[],
  newId: () => string = newItemId
): { layout: HomeLayout; placed: number } {
  const known = knownDeviceKeys(layout)
  const baseIndex = layout.rooms.findIndex((room) => room.id === layout.baseRoomId)
  if (baseIndex < 0) return { layout, placed: 0 }
  const base: Room = { ...layout.rooms[baseIndex], items: [...layout.rooms[baseIndex].items] }
  let placed = 0

  for (const device of devices) {
    const key = deviceRefKey(device)
    if (known.has(key)) continue
    const item = deviceItem(base, device, newId())
    if (!item) continue
    known.add(key)
    base.items.push(item)
    placed++
  }

  if (!placed) return { layout, placed }
  const rooms = layout.rooms.map((room, i) => (i === baseIndex ? base : room))
  return { layout: { ...layout, rooms }, placed }
}

/**
 * Leva um aparelho para um comodo, na proxima posicao livre do padrao. Se
 * ele estava em outro comodo ou sem comodo, sai de la: um aparelho fica em
 * no maximo um comodo. O apelido local acompanha o aparelho.
 */
export function assignDevice(
  layout: HomeLayout,
  roomId: string,
  device: DeviceCandidate,
  newId: () => string = newItemId
): { layout: HomeLayout; itemId?: string } {
  const key = deviceRefKey(device)
  const target = findRoom(layout, roomId)
  if (!target) return { layout }
  const current = findDevice(layout, key)
  if (current?.room.id === roomId) return { layout, itemId: current.item.id }

  const without: HomeLayout = {
    ...layout,
    rooms: layout.rooms.map((room) => ({ ...room, items: room.items.filter((item) => !item.device || deviceRefKey(item.device) !== key) })),
    unassignedDevices: layout.unassignedDevices.filter((ref) => deviceRefKey(ref) !== key)
  }
  const item = deviceItem(findRoom(without, roomId)!, device, newId(), current?.item.alias)
  if (!item) return { layout }
  return { layout: mapRoom(without, roomId, (room) => ({ ...room, items: [...room.items, item] })), itemId: item.id }
}

/** Tira um item do comodo. Um aparelho removido fica sem comodo, nunca sai da conta. */
export function removeItem(layout: HomeLayout, roomId: string, itemId: string): HomeLayout {
  const item = findRoom(layout, roomId)?.items.find((candidate) => candidate.id === itemId)
  if (!item) return layout
  const next = mapRoom(layout, roomId, (room) => ({ ...room, items: room.items.filter((candidate) => candidate.id !== itemId) }))
  return item.device ? { ...next, unassignedDevices: [...next.unassignedDevices, item.device] } : next
}

/** Muda posicao, giro, escala ou apelido de um item, sempre dentro do comodo. */
export function updateItem(
  layout: HomeLayout,
  roomId: string,
  itemId: string,
  patch: Partial<Pick<RoomItem, 'position' | 'rotationY' | 'scale' | 'alias'>>
): HomeLayout {
  return mapRoom(layout, roomId, (room) => ({
    ...room,
    items: room.items.map((item) => {
      if (item.id !== itemId) return item
      const next: RoomItem = { ...item, ...patch }
      if (patch.rotationY !== undefined) next.rotationY = normalizeRotation(patch.rotationY)
      if ('alias' in patch) {
        const alias = patch.alias?.trim().slice(0, ROOM_LIMITS.name)
        if (alias) next.alias = alias
        else delete next.alias
      }
      return clampItem(next, room.dimensions)
    })
  }))
}

/** Gira 90°. Itens de parede trocam entre a parede do fundo e a da esquerda. */
export function rotateItem(layout: HomeLayout, roomId: string, itemId: string, direction: 1 | -1 = 1): HomeLayout {
  const item = findRoom(layout, roomId)?.items.find((candidate) => candidate.id === itemId)
  if (!item) return layout
  return updateItem(layout, roomId, itemId, { rotationY: item.rotationY + direction * Math.PI / 2 })
}

/** Novo movel do catalogo, no centro do comodo. */
export function addFurniture(
  layout: HomeLayout,
  roomId: string,
  assetId: FurnitureAssetId,
  newId: () => string = newItemId
): { layout: HomeLayout; itemId?: string } {
  const room = findRoom(layout, roomId)
  if (!room || room.items.length >= ROOM_LIMITS.itemsPerRoom) return { layout }
  const item = clampItem({
    id: newId(), assetId, attachment: ASSET_CATALOG[assetId].attachment, position: [0, 0, 0], rotationY: 0, scale: 1
  }, room.dimensions)
  return { layout: mapRoom(layout, roomId, (current) => ({ ...current, items: [...current.items, item] })), itemId: item.id }
}

/**
 * Nova largura/profundidade. As paredes continuam ao fundo e a esquerda: os
 * itens acompanham esse canto, e o que ficaria fora e trazido para dentro.
 */
export function resizeRoom(layout: HomeLayout, roomId: string, dimensions: RoomDimensions): HomeLayout {
  return mapRoom(layout, roomId, (room) => {
    const next = {
      width: clamp(snap(dimensions.width), ROOM_LIMITS.width.min, ROOM_LIMITS.width.max),
      depth: clamp(snap(dimensions.depth), ROOM_LIMITS.depth.min, ROOM_LIMITS.depth.max)
    }
    const dx = (room.dimensions.width - next.width) / 2
    const dz = (room.dimensions.depth - next.depth) / 2
    return {
      ...room,
      dimensions: next,
      items: room.items.map((item) => clampItem({ ...item, position: [item.position[0] + dx, item.position[1], item.position[2] + dz] }, next))
    }
  })
}

function roomName(name: string): string {
  return name.trim().slice(0, ROOM_LIMITS.name)
}

/** Novo comodo a partir do padrao original, sem aparelhos. */
export function createRoom(
  layout: HomeLayout,
  name: string,
  id = `room-${globalThis.crypto.randomUUID()}`
): { layout: HomeLayout; roomId?: string } {
  const clean = roomName(name)
  if (!clean || layout.rooms.length >= ROOM_LIMITS.rooms) return { layout }
  return { layout: { ...layout, rooms: [...layout.rooms, defaultRoom(id, clean)] }, roomId: id }
}

export function renameRoom(layout: HomeLayout, roomId: string, name: string): HomeLayout {
  const clean = roomName(name)
  return clean ? mapRoom(layout, roomId, (room) => ({ ...room, name: clean })) : layout
}

/** Exclui um comodo (nunca o base). Os aparelhos dele ficam sem comodo. */
export function deleteRoom(layout: HomeLayout, roomId: string): HomeLayout {
  const room = findRoom(layout, roomId)
  if (!room || roomId === layout.baseRoomId) return layout
  const freed = room.items.flatMap((item) => (item.device ? [item.device] : []))
  const next: HomeLayout = {
    ...layout,
    rooms: layout.rooms.filter((candidate) => candidate.id !== roomId),
    unassignedDevices: [...layout.unassignedDevices, ...freed]
  }
  if (next.selectedRoomId === roomId) delete next.selectedRoomId
  return next
}

/**
 * Volta o comodo ao padrao original: tamanho e moveis da sala padrao. O nome
 * e os aparelhos ficam; os aparelhos voltam aos pontos padrao, na ordem em
 * que estavam, com os apelidos.
 */
export function resetRoom(layout: HomeLayout, roomId: string): HomeLayout {
  return mapRoom(layout, roomId, (room) => {
    const fresh = defaultRoom(room.id, room.name)
    for (const item of room.items) {
      if (!item.device) continue
      const slot = nextSlot(fresh, item.assetId)
      fresh.items.push(slot
        ? { ...item, position: slot.position, rotationY: slot.rotationY, scale: 1 }
        : clampItem(item, fresh.dimensions))
    }
    return fresh
  })
}
