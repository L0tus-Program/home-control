import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSource } from './load-source.mjs'

const home = await loadSource('src/shared/home.ts')

const lamp = (deviceId) => ({ driverId: 'tuya', deviceId, kind: 'light' })
const ac = (deviceId) => ({ driverId: 'thinq', deviceId, kind: 'air-conditioner' })
let counter = 0
const ids = () => `item-${++counter}`

function withDevices(...devices) {
  return home.placeNewDevices(home.createHomeLayout(), devices, ids).layout
}

const base = (layout) => home.findRoom(layout, layout.baseRoomId)
const item = (layout, roomId, id) => home.findRoom(layout, roomId).items.find((candidate) => candidate.id === id)
const byAsset = (room, assetId) => room.items.find((candidate) => candidate.assetId === assetId)
const inside = (room, it) => {
  const box = home.footprint(it)
  const { backZ, leftX } = home.wallsOf(room.dimensions)
  const eps = 1e-9
  return box.minX >= leftX - eps && box.maxX <= room.dimensions.width / 2 + eps &&
    box.minZ >= backZ - eps && box.maxZ <= room.dimensions.depth / 2 + eps
}

/** O store valida tudo que o editor produz antes de gravar. */
async function validator(t) {
  const directory = mkdtempSync(join(tmpdir(), 'home-control-edit-'))
  globalThis.__homeLayoutFixture = { directory }
  t.after(() => {
    delete globalThis.__homeLayoutFixture
    rmSync(directory, { recursive: true, force: true })
  })
  const store = await loadSource('src/main/home-layout-store.ts', {
    electron: 'export const app = { getPath: () => globalThis.__homeLayoutFixture.directory }'
  })
  return store.parseHomeLayout
}

test('novo cômodo nasce do padrão original, sem aparelhos, mesmo com a base editada', () => {
  let layout = withDevices(lamp('a'))
  const sofa = byAsset(base(layout), 'sofa-l')
  layout = home.updateItem(layout, 'sala', sofa.id, { position: [1, 0, 1] })
  layout = home.resizeRoom(layout, 'sala', { width: 6, depth: 5 })
  const created = home.createRoom(layout, '  Quarto  ', 'quarto')
  const quarto = home.findRoom(created.layout, 'quarto')
  assert.equal(created.roomId, 'quarto')
  assert.equal(quarto.name, 'Quarto')
  assert.deepEqual(quarto, home.defaultRoom('quarto', 'Quarto'))
  assert.equal(quarto.items.some((it) => it.device), false)
  assert.equal(home.createRoom(layout, '   ').roomId, undefined)
})

test('mover aparelho para outro cômodo tira do anterior e leva o apelido', async (t) => {
  const parse = await validator(t)
  let layout = withDevices(lamp('a'), lamp('b'))
  const a = base(layout).items.find((it) => it.device?.deviceId === 'a')
  layout = home.updateItem(layout, 'sala', a.id, { alias: '  Luz do sofá  ' })
  layout = home.createRoom(layout, 'Quarto', 'quarto').layout
  const moved = home.assignDevice(layout, 'quarto', lamp('a'), ids)
  assert.ok(moved.itemId)
  const found = home.findDevice(moved.layout, 'tuya:a')
  assert.equal(found.room.id, 'quarto')
  assert.equal(found.item.alias, 'Luz do sofá')
  assert.deepEqual(found.item.position, home.LIGHT_SPOTS[0])
  assert.equal(base(moved.layout).items.some((it) => it.device?.deviceId === 'a'), false)
  assert.doesNotThrow(() => parse(moved.layout))
  // Já está lá: nada muda.
  assert.equal(home.assignDevice(moved.layout, 'quarto', lamp('a')).layout, moved.layout)
})

test('remover do cômodo deixa o aparelho sem cômodo e ele não volta sozinho', () => {
  let layout = withDevices(lamp('a'))
  const a = base(layout).items.find((it) => it.device)
  layout = home.removeItem(layout, 'sala', a.id)
  assert.deepEqual(layout.unassignedDevices, [{ driverId: 'tuya', deviceId: 'a' }])
  assert.equal(home.placeNewDevices(layout, [lamp('a')]).placed, 0)
  // Trazer de volta pelo editor tira da lista "sem cômodo".
  const back = home.assignDevice(layout, 'sala', lamp('a'), ids).layout
  assert.deepEqual(back.unassignedDevices, [])
  assert.equal(home.findDevice(back, 'tuya:a').room.id, 'sala')
})

test('excluir cômodo libera os aparelhos e nunca exclui o base', async (t) => {
  const parse = await validator(t)
  let layout = withDevices(lamp('a'))
  layout = home.createRoom(layout, 'Quarto', 'quarto').layout
  layout = home.assignDevice(layout, 'quarto', lamp('a'), ids).layout
  layout = { ...layout, selectedRoomId: 'quarto' }
  assert.equal(home.deleteRoom(layout, 'sala'), layout)
  const deleted = home.deleteRoom(layout, 'quarto')
  assert.equal(home.findRoom(deleted, 'quarto'), undefined)
  assert.deepEqual(deleted.unassignedDevices, [{ driverId: 'tuya', deviceId: 'a' }])
  assert.equal('selectedRoomId' in deleted, false)
  assert.doesNotThrow(() => parse(deleted))
})

test('mover e girar ficam dentro do cômodo', async (t) => {
  const parse = await validator(t)
  let layout = home.createHomeLayout()
  const room = base(layout)
  for (const it of room.items) {
    layout = home.updateItem(layout, 'sala', it.id, { position: [50, 9, -50] })
    layout = home.rotateItem(layout, 'sala', it.id)
  }
  for (const it of base(layout).items) assert.ok(inside(base(layout), it), it.assetId)
  const shelf = byAsset(base(layout), 'bookshelf')
  // Estante começou a 90°; mais 90° fica em 180°.
  assert.ok(Math.abs(shelf.rotationY - Math.PI) < 1e-9)
  layout = home.rotateItem(layout, 'sala', shelf.id)
  layout = home.rotateItem(layout, 'sala', shelf.id)
  assert.ok(Math.abs(byAsset(base(layout), 'bookshelf').rotationY) < 1e-9, 'quatro giros voltam a zero')
  assert.doesNotThrow(() => parse(layout))
})

test('ar-condicionado só desliza na parede e troca de parede ao girar', () => {
  let layout = withDevices(ac('ar'))
  const air = base(layout).items.find((it) => it.device)
  const { backZ, leftX } = home.wallsOf(base(layout).dimensions)
  layout = home.updateItem(layout, 'sala', air.id, { position: [1.5, 2.65, 2] })
  let current = item(layout, 'sala', air.id)
  assert.equal(home.wallOf(current), 'back')
  assert.ok(Math.abs(current.position[2] - (backZ + 0.126)) < 1e-9, 'continua rente à parede do fundo')
  assert.equal(current.position[0], 1.5)

  layout = home.rotateItem(layout, 'sala', air.id)
  current = item(layout, 'sala', air.id)
  assert.equal(home.wallOf(current), 'left')
  assert.ok(Math.abs(current.position[0] - (leftX + 0.126)) < 1e-9, 'passa para a parede da esquerda')
})

test('redimensionar acompanha o canto das paredes e traz para dentro o que sobrar', async (t) => {
  const parse = await validator(t)
  let layout = withDevices(ac('ar'), lamp('a'))
  const before = base(layout)
  const shelf = byAsset(before, 'bookshelf')
  const plant = byAsset(before, 'plant')
  layout = home.resizeRoom(layout, 'sala', { width: 5, depth: 4 })
  const after = base(layout)
  assert.deepEqual(after.dimensions, { width: 5, depth: 4 })
  for (const it of after.items) assert.ok(inside(after, it), it.assetId)
  // A estante continua encostada na parede da esquerda.
  const { leftX } = home.wallsOf(after.dimensions)
  assert.ok(Math.abs(byAsset(after, 'bookshelf').position[0] - (leftX + 0.18)) < 1e-9)
  assert.notDeepEqual(byAsset(after, 'bookshelf').position, shelf.position)
  // A planta, que ficaria fora pela direita, foi trazida para dentro.
  assert.ok(byAsset(after, 'plant').position[0] < plant.position[0])
  assert.doesNotThrow(() => parse(layout))

  const clamped = home.resizeRoom(layout, 'sala', { width: 30, depth: 1.1 })
  assert.deepEqual(base(clamped).dimensions, { width: 10, depth: 4 })
})

test('aparelho novo num cômodo redimensionado cai dentro dele', async (t) => {
  const parse = await validator(t)
  let layout = home.resizeRoom(home.createHomeLayout(), 'sala', { width: 5, depth: 4 })
  layout = home.placeNewDevices(layout, [lamp('a'), lamp('b'), lamp('c'), lamp('d'), ac('x'), ac('y')], ids).layout
  for (const it of base(layout).items) assert.ok(inside(base(layout), it), `${it.assetId} ${it.position}`)
  assert.doesNotThrow(() => parse(layout))
})

test('móvel novo entra no centro e apelido vazio volta ao nome da conta', () => {
  let layout = withDevices(lamp('a'))
  const added = home.addFurniture(layout, 'sala', 'plant', { newId: ids })
  const plant = item(added.layout, 'sala', added.itemId)
  assert.deepEqual(plant.position, [0, 0, 0])
  assert.equal(plant.device, undefined)

  const a = base(layout).items.find((it) => it.device)
  layout = home.updateItem(layout, 'sala', a.id, { alias: 'Luz' })
  layout = home.updateItem(layout, 'sala', a.id, { alias: '   ' })
  assert.equal('alias' in item(layout, 'sala', a.id), false)
})

test('renomear ignora nome vazio', () => {
  const layout = home.createHomeLayout()
  assert.equal(home.renameRoom(layout, 'sala', '  ').rooms[0].name, 'Sala viva')
  assert.equal(home.renameRoom(layout, 'sala', ' Estar ').rooms[0].name, 'Estar')
})

test('restaurar padrão volta tamanho e móveis e mantém nome, aparelhos e apelidos', async (t) => {
  const parse = await validator(t)
  let layout = withDevices(lamp('a'), ac('ar'))
  const a = base(layout).items.find((it) => it.device?.deviceId === 'a')
  layout = home.renameRoom(layout, 'sala', 'Meu quarto')
  layout = home.updateItem(layout, 'sala', a.id, { alias: 'Luz da cama', position: [2, 0, 2] })
  layout = home.resizeRoom(layout, 'sala', { width: 5, depth: 4 })
  layout = home.addFurniture(layout, 'sala', 'bed-double', { newId: ids }).layout
  layout = home.removeItem(layout, 'sala', byAsset(base(layout), 'sofa-l').id)

  const reset = home.resetRoom(layout, 'sala')
  const room = base(reset)
  const fresh = home.defaultRoom('sala', 'Meu quarto')
  assert.equal(room.name, 'Meu quarto')
  assert.deepEqual(room.dimensions, home.DEFAULT_DIMENSIONS)
  assert.deepEqual(room.items.filter((it) => !it.device), fresh.items)
  const lampItem = room.items.find((it) => it.device?.deviceId === 'a')
  assert.equal(lampItem.id, a.id)
  assert.equal(lampItem.alias, 'Luz da cama')
  assert.deepEqual(lampItem.position, home.LIGHT_SPOTS[0])
  assert.deepEqual(room.items.find((it) => it.device?.deviceId === 'ar').position, home.AC_MOUNTS[0].position)
  assert.doesNotThrow(() => parse(reset))
})

test('todos os móveis do catálogo cabem no menor cômodo e passam na validação', async (t) => {
  const parse = await validator(t)
  let layout = home.resizeRoom(home.createHomeLayout(), 'sala', { width: 5, depth: 4 })
  for (const assetId of home.FURNITURE_ASSETS) {
    const added = home.addFurniture(layout, 'sala', assetId, { newId: ids })
    assert.ok(added.itemId, assetId)
    layout = home.rotateItem(added.layout, 'sala', added.itemId)
  }
  for (const it of base(layout).items) assert.ok(inside(base(layout), it), it.assetId)
  assert.doesNotThrow(() => parse(layout))
  assert.ok(home.FURNITURE_ASSETS.length >= 17)
  assert.ok(home.FURNITURE_ASSETS.every((id) => ['sala', 'quarto', 'mesa'].includes(home.furnitureCategory(id))))
})

test('móvel solto num ponto da maquete fica ali, dentro do cômodo', () => {
  const layout = home.createHomeLayout()
  const placed = home.addFurniture(layout, 'sala', 'chair', { position: [1.5, 0, 0.75], newId: ids })
  assert.deepEqual(item(placed.layout, 'sala', placed.itemId).position, [1.5, 0, 0.75])
  const outside = home.addFurniture(layout, 'sala', 'wardrobe', { position: [40, 0, -40], newId: ids })
  const wardrobe = item(outside.layout, 'sala', outside.itemId)
  assert.ok(inside(base(outside.layout), wardrobe))
})
