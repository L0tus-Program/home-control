import { app } from 'electron'
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import {
  ASSET_CATALOG,
  HOME_LAYOUT_SCHEMA_VERSION,
  ROOM_LIMITS,
  WALL_HEIGHT,
  createHomeLayout,
  deviceRefKey,
  isAssetId,
  isDeviceAsset,
  placeNewDevices,
  type DeviceCandidate,
  type DeviceRef,
  type HomeLayout,
  type Room,
  type RoomItem,
  type Vec3
} from '../shared/home'
import type { DeviceKind } from '../shared/types'

/**
 * Layout da casa em `userData/home-layout.json`, separado do cofre e do
 * config.json das integracoes.
 *
 * Tudo que entra aqui passa por `parseHomeLayout`, que devolve uma copia
 * limpa (campos desconhecidos ficam de fora). Gravacoes sao atomicas: o novo
 * conteudo vai para um .tmp e so entao substitui o arquivo, e a versao
 * anterior fica em .bak. Um arquivo invalido nunca e apagado: e renomeado
 * para inspecao e o app segue com o backup ou com o comodo base padrao.
 */

const FILE = 'home-layout.json'
const dir = (): string => app.getPath('userData')
const path = (name: string): string => join(dir(), name)

const MAX_ID = 64
const MAX_NAME = 60
const MAX_REF_PART = 256
const MAX_UNASSIGNED = 1000
const MAX_CANDIDATES = 500
const DEVICE_KINDS: readonly DeviceKind[] = ['air-conditioner', 'light', 'unknown']

export class InvalidHomeLayout extends Error {
  constructor(detail: string) {
    super(`Layout da casa inválido: ${detail}`)
    this.name = 'InvalidHomeLayout'
  }
}

export class HomeLayoutConflict extends Error {
  constructor() {
    super('O layout foi alterado em outro lugar. Recarregue antes de salvar.')
    this.name = 'HomeLayoutConflict'
  }
}

// ── Validacao ──────────────────────────────────────────────────────────────

function fail(detail: string): never {
  throw new InvalidHomeLayout(detail)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') fail(`${field} deve ser texto.`)
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) fail(`${field} deve ter de 1 a ${max} caracteres.`)
  return trimmed
}

function number(value: unknown, field: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} deve ser um número finito.`)
  if (value < min || value > max) fail(`${field} fora do limite (${min} a ${max}).`)
  return value
}

function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(`${field} deve ser uma lista.`)
  if (value.length > max) fail(`${field} tem mais de ${max} itens.`)
  return value
}

function deviceRef(value: unknown, field: string): DeviceRef {
  if (!isRecord(value)) fail(`${field} inválido.`)
  return {
    driverId: text(value.driverId, `${field}.driverId`, MAX_REF_PART),
    deviceId: text(value.deviceId, `${field}.deviceId`, MAX_REF_PART)
  }
}

function roomItem(value: unknown, field: string, room: Room['dimensions']): RoomItem {
  if (!isRecord(value)) fail(`${field} inválido.`)
  const id = text(value.id, `${field}.id`, MAX_ID)
  if (!isAssetId(value.assetId)) fail(`${field}.assetId fora do catálogo.`)
  const assetId = value.assetId
  const attachment = ASSET_CATALOG[assetId].attachment
  if (value.attachment !== attachment) fail(`${field}.attachment deve ser "${attachment}" para ${assetId}.`)

  if (!Array.isArray(value.position) || value.position.length !== 3) fail(`${field}.position deve ter 3 números.`)
  const position: Vec3 = [
    number(value.position[0], `${field}.position[0]`, -room.width / 2, room.width / 2),
    number(value.position[1], `${field}.position[1]`, 0, WALL_HEIGHT),
    number(value.position[2], `${field}.position[2]`, -room.depth / 2, room.depth / 2)
  ]

  const item: RoomItem = {
    id,
    assetId,
    attachment,
    position,
    rotationY: number(value.rotationY, `${field}.rotationY`, -2 * Math.PI, 2 * Math.PI),
    scale: number(value.scale, `${field}.scale`, ROOM_LIMITS.scale.min, ROOM_LIMITS.scale.max)
  }
  if (isDeviceAsset(assetId)) {
    if (value.device === undefined) fail(`${field}.device é obrigatório para ${assetId}.`)
    item.device = deviceRef(value.device, `${field}.device`)
  } else if (value.device !== undefined) {
    fail(`${field}: ${assetId} é decoração e não aceita aparelho.`)
  }
  if (value.alias !== undefined) item.alias = text(value.alias, `${field}.alias`, MAX_NAME)
  return item
}

function room(value: unknown, field: string): Room {
  if (!isRecord(value)) fail(`${field} inválido.`)
  if (!isRecord(value.dimensions)) fail(`${field}.dimensions inválido.`)
  const dimensions = {
    width: number(value.dimensions.width, `${field}.dimensions.width`, ROOM_LIMITS.width.min, ROOM_LIMITS.width.max),
    depth: number(value.dimensions.depth, `${field}.dimensions.depth`, ROOM_LIMITS.depth.min, ROOM_LIMITS.depth.max)
  }
  return {
    id: text(value.id, `${field}.id`, MAX_ID),
    name: text(value.name, `${field}.name`, MAX_NAME),
    dimensions,
    items: list(value.items, `${field}.items`, ROOM_LIMITS.itemsPerRoom)
      .map((item, i) => roomItem(item, `${field}.items[${i}]`, dimensions))
  }
}

/**
 * Valida um layout vindo do disco ou do renderer e devolve uma copia so com
 * os campos conhecidos. Lanca InvalidHomeLayout explicando o primeiro problema.
 */
export function parseHomeLayout(value: unknown): HomeLayout {
  if (!isRecord(value)) fail('o documento deve ser um objeto.')
  if (value.schemaVersion !== HOME_LAYOUT_SCHEMA_VERSION) fail(`schemaVersion deve ser ${HOME_LAYOUT_SCHEMA_VERSION}.`)
  const revision = number(value.revision, 'revision', 0, Number.MAX_SAFE_INTEGER)
  if (!Number.isInteger(revision)) fail('revision deve ser inteiro.')

  const rooms = list(value.rooms, 'rooms', ROOM_LIMITS.rooms).map((item, i) => room(item, `rooms[${i}]`))
  if (!rooms.length) fail('é preciso ao menos um cômodo.')
  const unassignedDevices = list(value.unassignedDevices, 'unassignedDevices', MAX_UNASSIGNED)
    .map((ref, i) => deviceRef(ref, `unassignedDevices[${i}]`))

  const roomIds = new Set<string>()
  const itemIds = new Set<string>()
  const devices = new Set<string>()
  const claim = (ref: DeviceRef, where: string): void => {
    const key = deviceRefKey(ref)
    if (devices.has(key)) fail(`o aparelho ${key} aparece mais de uma vez (${where}).`)
    devices.add(key)
  }
  for (const r of rooms) {
    if (roomIds.has(r.id)) fail(`id de cômodo repetido: ${r.id}.`)
    roomIds.add(r.id)
    for (const item of r.items) {
      if (itemIds.has(item.id)) fail(`id de item repetido: ${item.id}.`)
      itemIds.add(item.id)
      if (item.device) claim(item.device, `cômodo ${r.id}`)
    }
  }
  for (const ref of unassignedDevices) claim(ref, 'sem cômodo')

  const baseRoomId = text(value.baseRoomId, 'baseRoomId', MAX_ID)
  if (!roomIds.has(baseRoomId)) fail('baseRoomId não corresponde a nenhum cômodo.')
  const layout: HomeLayout = { schemaVersion: HOME_LAYOUT_SCHEMA_VERSION, revision, baseRoomId, rooms, unassignedDevices }
  if (value.selectedRoomId !== undefined) {
    const selected = text(value.selectedRoomId, 'selectedRoomId', MAX_ID)
    if (!roomIds.has(selected)) fail('selectedRoomId não corresponde a nenhum cômodo.')
    layout.selectedRoomId = selected
  }
  return layout
}

function parseCandidates(value: unknown): DeviceCandidate[] {
  return list(value, 'aparelhos', MAX_CANDIDATES).map((item, i) => {
    if (!isRecord(item)) fail(`aparelhos[${i}] inválido.`)
    if (!DEVICE_KINDS.includes(item.kind as DeviceKind)) fail(`aparelhos[${i}].kind desconhecido.`)
    return { ...deviceRef(item, `aparelhos[${i}]`), kind: item.kind as DeviceKind }
  })
}

// ── Disco ──────────────────────────────────────────────────────────────────

/** null quando o arquivo nao existe; InvalidHomeLayout se existir e estiver ruim. */
function readLayout(name: string): HomeLayout | null {
  const file = path(name)
  if (!existsSync(file)) return null
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    fail(`${name} não é JSON válido.`)
  }
  return parseHomeLayout(raw)
}

/** Grava num .tmp com fsync e troca de uma vez; o anterior vira .bak. */
function writeLayout(layout: HomeLayout): void {
  mkdirSync(dir(), { recursive: true })
  const target = path(FILE)
  const tmp = path(`${FILE}.tmp`)
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, JSON.stringify(layout, null, 2))
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  if (existsSync(target)) copyFileSync(target, path(`${FILE}.bak`))
  renameSync(tmp, target)
}

/** Tira o arquivo invalido do caminho sem apaga-lo. */
function quarantine(): string {
  const name = `home-layout.invalid-${Date.now()}.json`
  renameSync(path(FILE), path(name))
  return name
}

/**
 * Le o layout. Na primeira abertura cria o comodo base padrao. Se o arquivo
 * estiver invalido, guarda-o ao lado e recupera do backup ou do padrao.
 */
export function loadHomeLayout(): HomeLayout {
  try {
    const layout = readLayout(FILE)
    if (layout) return layout
  } catch (cause) {
    if (!(cause instanceof InvalidHomeLayout)) throw cause
    const kept = quarantine()
    console.warn(`[home-layout] ${cause.message} Arquivo preservado como ${kept}.`)
    try {
      const backup = readLayout(`${FILE}.bak`)
      if (backup) {
        writeLayout(backup)
        return backup
      }
    } catch (backupCause) {
      if (!(backupCause instanceof InvalidHomeLayout)) throw backupCause
    }
  }
  const fresh = createHomeLayout()
  writeLayout(fresh)
  return fresh
}

/**
 * Salva um layout editado. `expectedRevision` e a revisao em que a edicao se
 * baseou: se o arquivo ja estiver em outra, recusa em vez de sobrescrever.
 */
export function saveHomeLayout(input: unknown, expectedRevision: unknown): HomeLayout {
  const current = loadHomeLayout()
  if (expectedRevision !== current.revision) throw new HomeLayoutConflict()
  const next = { ...parseHomeLayout(input), revision: current.revision + 1 }
  writeLayout(next)
  return next
}

/**
 * Poe no comodo base os aparelhos conectados que o layout ainda nao conhece.
 * So grava se algo mudou; aparelhos ausentes da lista nunca saem do layout.
 */
export function placeDevicesInBaseRoom(devices: unknown): HomeLayout {
  const candidates = parseCandidates(devices)
  const current = loadHomeLayout()
  const { layout, placed } = placeNewDevices(current, candidates)
  if (!placed) return current
  const next = { ...parseHomeLayout(layout), revision: current.revision + 1 }
  writeLayout(next)
  return next
}
