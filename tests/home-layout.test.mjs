import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadSource } from './load-source.mjs'

const electron = `
  export const app = { getPath: () => globalThis.__homeLayoutFixture.directory }
`

/** Cada carga do modulo e um "reinicio" do app apontando para o mesmo userData. */
async function storeFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'home-control-layout-'))
  globalThis.__homeLayoutFixture = { directory }
  t.after(() => {
    delete globalThis.__homeLayoutFixture
    rmSync(directory, { recursive: true, force: true })
  })
  const restart = () => loadSource('src/main/home-layout-store.ts', { electron })
  return { store: await restart(), restart, directory, file: join(directory, 'home-layout.json') }
}

const home = await loadSource('src/shared/home.ts')

const lamp = (deviceId, driverId = 'tuya') => ({ driverId, deviceId, kind: 'light' })
const ac = (deviceId) => ({ driverId: 'thinq', deviceId, kind: 'air-conditioner' })
const clone = (value) => JSON.parse(JSON.stringify(value))
const deviceItems = (layout, roomId = layout.baseRoomId) =>
  layout.rooms.find((room) => room.id === roomId).items.filter((item) => item.device)
const itemFor = (layout, deviceId) => layout.rooms.flatMap((room) => room.items).find((item) => item.device?.deviceId === deviceId)

test('primeira abertura cria o cômodo base padrão e reiniciar preserva o layout', async (t) => {
  const { store, restart, file } = await storeFixture(t)
  const first = store.loadHomeLayout()
  assert.equal(first.schemaVersion, 1)
  assert.equal(first.revision, 0)
  assert.equal(first.rooms.length, 1)
  assert.equal(first.baseRoomId, first.rooms[0].id)
  assert.deepEqual(first.rooms[0].dimensions, { width: 8, depth: 7 })
  assert.deepEqual(first.rooms[0].items.map((item) => item.assetId).sort(),
    ['bookshelf', 'coffee-table', 'plant', 'rug', 'sofa-l'])
  assert.deepEqual(first.unassignedDevices, [])
  assert.ok(existsSync(file))

  const placed = store.placeDevicesInBaseRoom([lamp('a')])
  const edited = clone(placed)
  edited.rooms[0].name = 'Sala de estar'
  itemFor(edited, 'a').position = [2, 0, 1]
  const saved = store.saveHomeLayout(edited, placed.revision)

  const reopened = (await restart()).loadHomeLayout()
  assert.deepEqual(reopened, saved)
  assert.equal(reopened.rooms[0].name, 'Sala de estar')
  assert.deepEqual(itemFor(reopened, 'a').position, [2, 0, 1])
})

test('defaultRoom sempre nasce do padrão original e sem aparelhos', () => {
  const room = home.defaultRoom('quarto', 'Quarto')
  assert.equal(room.id, 'quarto')
  assert.equal(room.items.some((item) => item.device), false)
  assert.ok(room.items.every((item) => item.id.startsWith('quarto-')))
  // Mexer numa cópia não altera o padrão.
  room.items[0].position[0] = 3
  room.dimensions.width = 5
  assert.notEqual(home.defaultRoom('quarto').items[0].position[0], 3)
  assert.equal(home.defaultRoom().dimensions.width, 8)
})

test('validação recusa números não finitos, limites, catálogo e estrutura', async (t) => {
  const { store } = await storeFixture(t)
  const base = store.placeDevicesInBaseRoom([lamp('a')])
  const cases = [
    ['posição NaN', (l) => { l.rooms[0].items[0].position[0] = NaN }],
    ['posição infinita', (l) => { l.rooms[0].items[0].position[2] = Infinity }],
    ['fora da sala', (l) => { l.rooms[0].items[0].position[0] = 4.5 }],
    ['acima do pé-direito', (l) => { l.rooms[0].items[0].position[1] = 3.5 }],
    ['largura acima do limite', (l) => { l.rooms[0].dimensions.width = 10.5 }],
    ['profundidade abaixo do limite', (l) => { l.rooms[0].dimensions.depth = 3 }],
    ['escala', (l) => { l.rooms[0].items[0].scale = 3 }],
    ['asset fora do catálogo', (l) => { l.rooms[0].items[0].assetId = 'https://exemplo.com/modelo.glb' }],
    ['fixação incoerente', (l) => { l.rooms[0].items[0].attachment = 'ceiling' }],
    ['decoração com aparelho', (l) => { l.rooms[0].items.find((i) => !i.device).device = { driverId: 'tuya', deviceId: 'x' } }],
    ['aparelho sem referência', (l) => { delete itemFor(l, 'a').device }],
    ['id de item repetido', (l) => { l.rooms[0].items[1].id = l.rooms[0].items[0].id }],
    ['sem cômodos', (l) => { l.rooms = [] }],
    ['cômodo base inexistente', (l) => { l.baseRoomId = 'nada' }],
    ['versão desconhecida', (l) => { l.schemaVersion = 2 }],
    ['nome vazio', (l) => { l.rooms[0].name = '   ' }]
  ]
  for (const [name, mutate] of cases) {
    const layout = clone(base)
    mutate(layout)
    assert.throws(() => store.parseHomeLayout(layout), { name: 'InvalidHomeLayout' }, name)
    assert.throws(() => store.saveHomeLayout(layout, base.revision), { name: 'InvalidHomeLayout' }, name)
  }
  assert.deepEqual(store.loadHomeLayout(), base)
})

test('validação devolve só campos conhecidos', async (t) => {
  const { store } = await storeFixture(t)
  const layout = clone(store.loadHomeLayout())
  layout.script = 'alert(1)'
  layout.rooms[0].items[0].component = 'EvilMesh'
  layout.rooms[0].name = '  Sala  '
  const saved = store.saveHomeLayout(layout, 0)
  assert.equal('script' in saved, false)
  assert.equal('component' in saved.rooms[0].items[0], false)
  assert.equal(saved.rooms[0].name, 'Sala')
})

test('um aparelho fica em no máximo um cômodo', async (t) => {
  const { store } = await storeFixture(t)
  const base = store.placeDevicesInBaseRoom([lamp('a')])

  const twiceInRoom = clone(base)
  twiceInRoom.rooms[0].items.push({ ...clone(itemFor(base, 'a')), id: 'outro' })
  assert.throws(() => store.saveHomeLayout(twiceInRoom, base.revision), /aparece mais de uma vez/)

  const twoRooms = clone(base)
  const quarto = home.defaultRoom('quarto', 'Quarto')
  quarto.items.push({ ...clone(itemFor(base, 'a')), id: 'no-quarto' })
  twoRooms.rooms.push(quarto)
  assert.throws(() => store.saveHomeLayout(twoRooms, base.revision), /aparece mais de uma vez/)

  const alsoUnassigned = clone(base)
  alsoUnassigned.unassignedDevices.push({ driverId: 'tuya', deviceId: 'a' })
  assert.throws(() => store.saveHomeLayout(alsoUnassigned, base.revision), /aparece mais de uma vez/)

  // Mesmo id em integrações diferentes são aparelhos diferentes.
  const otherDriver = clone(base)
  otherDriver.unassignedDevices.push({ driverId: 'thinq', deviceId: 'a' })
  assert.doesNotThrow(() => store.saveHomeLayout(otherDriver, base.revision))
})

test('aparelhos novos entram no cômodo base na próxima posição livre do padrão', async (t) => {
  const { store } = await storeFixture(t)
  const first = store.placeDevicesInBaseRoom([ac('ar'), lamp('a'), lamp('b')])
  assert.equal(first.revision, 1)
  assert.deepEqual(itemFor(first, 'a').position, home.LIGHT_SPOTS[0])
  assert.deepEqual(itemFor(first, 'b').position, home.LIGHT_SPOTS[1])
  assert.deepEqual(itemFor(first, 'ar').position, home.AC_MOUNTS[0].position)
  assert.equal(itemFor(first, 'ar').attachment, 'wall')
  assert.equal(itemFor(first, 'a').assetId, 'floor-lamp')

  // Já conhecidos: nada muda e nada é gravado.
  assert.equal(store.placeDevicesInBaseRoom([lamp('a'), lamp('b'), ac('ar')]).revision, 1)

  // O usuário tirou a lâmpada "a" do primeiro ponto; a nova ocupa o ponto livre.
  const moved = clone(first)
  itemFor(moved, 'a').position = [2, 0, 2]
  const saved = store.saveHomeLayout(moved, first.revision)
  const next = store.placeDevicesInBaseRoom([lamp('c'), ac('ar2')])
  assert.equal(next.revision, saved.revision + 1)
  assert.deepEqual(itemFor(next, 'c').position, home.LIGHT_SPOTS[0])
  assert.deepEqual(itemFor(next, 'a').position, [2, 0, 2])
  assert.deepEqual(itemFor(next, 'ar2').position, home.AC_MOUNTS[1].position)
  assert.equal(itemFor(next, 'ar2').rotationY, home.AC_MOUNTS[1].rotationY)
})

test('auto-colocação respeita sem cômodo, outros cômodos e aparelhos ausentes', async (t) => {
  const { store } = await storeFixture(t)
  const first = store.placeDevicesInBaseRoom([lamp('a'), lamp('b')])
  const edited = clone(first)
  // "b" foi tirada do cômodo; "a" foi para outro cômodo.
  const b = itemFor(edited, 'b')
  edited.rooms[0].items = edited.rooms[0].items.filter((item) => item !== b)
  edited.unassignedDevices.push(b.device)
  const quarto = home.defaultRoom('quarto', 'Quarto')
  const a = itemFor(edited, 'a')
  edited.rooms[0].items = edited.rooms[0].items.filter((item) => item !== a)
  quarto.items.push(a)
  edited.rooms.push(quarto)
  const saved = store.saveHomeLayout(edited, first.revision)

  // Lista vazia (nuvem fora do ar, aparelho removido da conta): nada sai do layout.
  assert.deepEqual(store.placeDevicesInBaseRoom([]), saved)
  const after = store.placeDevicesInBaseRoom([lamp('a'), lamp('b')])
  assert.deepEqual(after, saved)
  assert.deepEqual(deviceItems(after), [])
  assert.equal(deviceItems(after, 'quarto').length, 1)

  // Tipo sem representação no catálogo não é colocado.
  assert.deepEqual(store.placeDevicesInBaseRoom([{ driverId: 'thinq', deviceId: 'x', kind: 'unknown' }]), saved)
})

test('entrada de aparelhos inválida é recusada', async (t) => {
  const { store } = await storeFixture(t)
  assert.throws(() => store.placeDevicesInBaseRoom('tudo'), { name: 'InvalidHomeLayout' })
  assert.throws(() => store.placeDevicesInBaseRoom([{ driverId: 'tuya', deviceId: '', kind: 'light' }]), { name: 'InvalidHomeLayout' })
  assert.throws(() => store.placeDevicesInBaseRoom([{ driverId: 'tuya', deviceId: 'a', kind: 'toaster' }]), { name: 'InvalidHomeLayout' })
})

test('edição baseada numa revisão antiga não sobrescreve a atual', async (t) => {
  const { store, file } = await storeFixture(t)
  const stale = store.loadHomeLayout()
  store.placeDevicesInBaseRoom([lamp('a')])
  const before = readFileSync(file, 'utf8')
  const edited = clone(stale)
  edited.rooms[0].name = 'Antiga'
  assert.throws(() => store.saveHomeLayout(edited, stale.revision), { name: 'HomeLayoutConflict' })
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('gravação atômica mantém backup e ignora .tmp de gravação interrompida', async (t) => {
  const { store, directory, file } = await storeFixture(t)
  const first = store.loadHomeLayout()
  const second = store.placeDevicesInBaseRoom([lamp('a')])
  assert.deepEqual(JSON.parse(readFileSync(`${file}.bak`, 'utf8')), first)
  assert.equal(existsSync(`${file}.tmp`), false)

  writeFileSync(`${file}.tmp`, '{"meio": ', 'utf8')
  assert.deepEqual(store.loadHomeLayout(), second)
  assert.deepEqual(readdirSync(directory).filter((name) => name.includes('invalid')), [])
})

test('arquivo inválido é preservado e recuperado do backup', async (t) => {
  const { store, directory, file } = await storeFixture(t)
  store.loadHomeLayout()
  const good = store.placeDevicesInBaseRoom([lamp('a')])
  const backup = JSON.parse(readFileSync(`${file}.bak`, 'utf8'))
  writeFileSync(file, '{quebrado', 'utf8')

  const recovered = store.loadHomeLayout()
  assert.deepEqual(recovered, backup)
  assert.notDeepEqual(recovered, good)
  const kept = readdirSync(directory).filter((name) => name.startsWith('home-layout.invalid-'))
  assert.equal(kept.length, 1)
  assert.equal(readFileSync(join(directory, kept[0]), 'utf8'), '{quebrado')
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), backup)
})

test('arquivo inválido sem backup válido volta ao cômodo base padrão', async (t) => {
  const { store, directory, file } = await storeFixture(t)
  // JSON válido, mas com revisão infinita; depois, um aparelho em dois lugares.
  writeFileSync(file, JSON.stringify({ ...home.createHomeLayout(), revision: 1 }).replace('"revision":1', '"revision":1e999'), 'utf8')
  writeFileSync(`${file}.bak`, 'lixo', 'utf8')

  const recovered = store.loadHomeLayout()
  assert.deepEqual(recovered, home.createHomeLayout())
  assert.equal(readdirSync(directory).filter((name) => name.startsWith('home-layout.invalid-')).length, 1)

  const duplicated = home.placeNewDevices(home.createHomeLayout(), [lamp('a')]).layout
  duplicated.unassignedDevices.push({ driverId: 'tuya', deviceId: 'a' })
  writeFileSync(file, JSON.stringify(duplicated), 'utf8')
  rmSync(`${file}.bak`, { force: true })
  assert.deepEqual(store.loadHomeLayout(), home.createHomeLayout())
})
