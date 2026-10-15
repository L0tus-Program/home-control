import * as THREE from 'three'
import { useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Line, OrbitControls, ContactShadows, SoftShadows } from '@react-three/drei'
import {
  ASSET_CATALOG,
  deviceRefKey,
  snap,
  wallsOf,
  type DeviceAssetId,
  type FurnitureAssetId,
  type Room,
  type RoomDimensions,
  type RoomItem
} from '../../../../../shared/home'
import type { Device } from '../../../../../shared/types'
import { useHoverCursor } from '../hooks'
import { cameraTarget, ROOM, type Vec3 } from '../layout'
import { Floor } from './Floor'
import { FURNITURE } from './furnitureRegistry'
import { LightDevice } from './LightDevice'
import { ACDevice } from './ACDevice'

export interface ItemMove {
  position: Vec3
  rotationY?: number
}

export interface RoomSceneEdit {
  selectedItemId: string | null
  onSelectItem: (id: string | null) => void
  onMoveItem: (id: string, move: ItemMove) => void
}

interface RoomSceneProps {
  room: Room
  /** Aparelhos por deviceKey, ja com apelidos e com marcadores dos indisponiveis. */
  devices: ReadonlyMap<string, Device>
  selectedKey: string | null
  onSelect: (key: string) => void
  /** Presente no modo edicao: clicar seleciona e arrastar move, sem comandos. */
  edit?: RoomSceneEdit
}

/** Iluminacao ambiente com leve respiracao, para dar vida a cena. */
function Atmosphere({ lightsOn, target }: { lightsOn: number; target: Vec3 }) {
  const ambRef = useRef<THREE.AmbientLight>(null)
  useFrame(({ clock }) => {
    if (ambRef.current) {
      ambRef.current.intensity = 0.28 + Math.sin(clock.getElapsedTime() * 0.4) * 0.02
    }
  })
  return (
    <>
      <ambientLight ref={ambRef} intensity={0.28} />
      <hemisphereLight args={['#cfe8ff', '#3b2f24', 0.45]} />
      <directionalLight
        position={[6, 9, 4]}
        intensity={0.9}
        color="#fff4e0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
      />
      {/* Brilho extra quando ha lampadas acesas */}
      {lightsOn > 0 && <pointLight position={[target[0], ROOM.wallHeight - 0.4, target[2]]} intensity={lightsOn * 0.6} color="#ffd9a0" distance={14} decay={2} />}
    </>
  )
}

interface DeviceAssetProps {
  device: Device
  isSelected: boolean
  onClick: () => void
}

const DEVICE_ASSETS: Record<DeviceAssetId, (props: DeviceAssetProps) => React.JSX.Element> = {
  'floor-lamp': LightDevice,
  'wall-ac': ACDevice
}

/** Posicao, giro e escala do item; a peca e desenhada na origem. */
function Placed({ item, children }: { item: RoomItem; children: React.ReactNode }) {
  return (
    <group position={item.position} rotation={[0, item.rotationY, 0]} scale={item.scale}>
      {children}
    </group>
  )
}

/** Raio do ponteiro no referencial do comodo (o grupo gira na entrada). */
function toRoomRay(ray: THREE.Ray, room: THREE.Object3D | null): THREE.Ray {
  return room ? ray.clone().applyMatrix4(room.matrixWorld.clone().invert()) : ray
}

function floorHit(ray: THREE.Ray): THREE.Vector3 | null {
  if (Math.abs(ray.direction.y) < 1e-6) return null
  const t = -ray.origin.y / ray.direction.y
  return t > 0 ? ray.at(t, new THREE.Vector3()) : null
}

/** Ponto na parede do fundo ou da esquerda sob o ponteiro, a que estiver na frente. */
function wallHit(ray: THREE.Ray, dimensions: RoomDimensions, height: number): ItemMove | null {
  const { backZ, leftX } = wallsOf(dimensions)
  const hits: { t: number; move: ItemMove }[] = []
  if (Math.abs(ray.direction.z) > 1e-6) {
    const t = (backZ - ray.origin.z) / ray.direction.z
    const p = ray.at(t, new THREE.Vector3())
    if (t > 0 && p.x >= leftX && p.x <= dimensions.width / 2) hits.push({ t, move: { position: [snap(p.x), height, backZ], rotationY: 0 } })
  }
  if (Math.abs(ray.direction.x) > 1e-6) {
    const t = (leftX - ray.origin.x) / ray.direction.x
    const p = ray.at(t, new THREE.Vector3())
    if (t > 0 && p.z >= backZ && p.z <= dimensions.depth / 2) hits.push({ t, move: { position: [leftX, height, snap(p.z)], rotationY: Math.PI / 2 } })
  }
  if (hits.length) return hits.sort((a, b) => a.t - b.t)[0].move
  // Fora das paredes: vai para a mais proxima do ponto no piso.
  const floor = floorHit(ray)
  if (!floor) return null
  return floor.z - backZ < floor.x - leftX
    ? { position: [snap(floor.x), height, backZ], rotationY: 0 }
    : { position: [leftX, height, snap(floor.z)], rotationY: Math.PI / 2 }
}

/** Contorno da peca no piso, quando selecionada no editor. */
function Footprint({ item }: { item: RoomItem }) {
  const b = ASSET_CATALOG[item.assetId].bounds
  const y = 0.02
  const points: Vec3[] = [[b.minX, y, b.minZ], [b.maxX, y, b.minZ], [b.maxX, y, b.maxZ], [b.minX, y, b.maxZ], [b.minX, y, b.minZ]]
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(b.minX + b.maxX) / 2, y - 0.005, (b.minZ + b.maxZ) / 2]}>
        <planeGeometry args={[b.maxX - b.minX, b.maxZ - b.minZ]} />
        <meshBasicMaterial color="#5ec8ff" transparent opacity={0.14} depthWrite={false} />
      </mesh>
      <Line points={points} color="#5ec8ff" lineWidth={2} />
    </>
  )
}

interface EditablePlacedProps {
  item: RoomItem
  room: Room
  roomGroup: React.RefObject<THREE.Group | null>
  selected: boolean
  edit: RoomSceneEdit
  children: React.ReactNode
}

/**
 * Item no modo edicao: clicar seleciona, arrastar move com encaixe na grade.
 * Enquanto arrasta, a camera fica parada para os gestos nao brigarem.
 */
function EditablePlaced({ item, room, roomGroup, selected, edit, children }: EditablePlacedProps) {
  const controls = useThree((state) => state.controls) as unknown as { enabled: boolean } | null
  const drag = useRef<{ pointerId: number; x: number; y: number; moved: boolean; offset: [number, number] } | null>(null)
  const { onPointerOver, onPointerOut } = useHoverCursor()

  const end = (event: ThreeEvent<PointerEvent>): void => {
    if (!drag.current || event.pointerId !== drag.current.pointerId) return
    drag.current = null
    ;(event.target as Element).releasePointerCapture?.(event.pointerId)
    if (controls) controls.enabled = true
  }

  return (
    <group
      position={item.position}
      rotation={[0, item.rotationY, 0]}
      scale={item.scale}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.stopPropagation()
        edit.onSelectItem(item.id)
        const hit = floorHit(toRoomRay(event.ray, roomGroup.current))
        drag.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          moved: false,
          offset: hit ? [hit.x - item.position[0], hit.z - item.position[2]] : [0, 0]
        }
        ;(event.target as Element).setPointerCapture?.(event.pointerId)
        if (controls) controls.enabled = false
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current || event.pointerId !== current.pointerId) return
        event.stopPropagation()
        if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 4) return
        current.moved = true
        const ray = toRoomRay(event.ray, roomGroup.current)
        if (item.attachment === 'wall') {
          const move = wallHit(ray, room.dimensions, item.position[1])
          if (move) edit.onMoveItem(item.id, move)
          return
        }
        const hit = floorHit(ray)
        if (hit) edit.onMoveItem(item.id, { position: [snap(hit.x - current.offset[0]), item.position[1], snap(hit.z - current.offset[1])] })
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {children}
      {selected && !item.device && <Footprint item={item} />}
    </group>
  )
}

/** Grade discreta de meio metro no piso, so durante a edicao. */
function EditGrid({ dimensions }: { dimensions: RoomDimensions }) {
  const geometry = useMemo(() => {
    const { width, depth } = dimensions
    const points: number[] = []
    for (let x = -width / 2; x <= width / 2 + 1e-6; x += 0.5) points.push(x, 0, -depth / 2, x, 0, depth / 2)
    for (let z = -depth / 2; z <= depth / 2 + 1e-6; z += 0.5) points.push(-width / 2, 0, z, width / 2, 0, z)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    return geo
  }, [dimensions])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <lineSegments geometry={geometry} position={[0, 0.009, 0]}>
      <lineBasicMaterial color="#5ec8ff" transparent opacity={0.16} depthWrite={false} />
    </lineSegments>
  )
}

function SceneContent({ room, devices, selectedKey, onSelect, edit }: RoomSceneProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [intro, setIntro] = useState(true)
  const { width, depth } = room.dimensions

  // Pequena animacao de entrada da camera/grupo
  useEffect(() => {
    const t = setTimeout(() => setIntro(false), 1200)
    return () => clearTimeout(t)
  }, [])

  useFrame(() => {
    if (groupRef.current && intro) {
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, -0.12, 0.04)
    }
  })

  return (
    <group ref={groupRef}>
      <Floor dimensions={room.dimensions} />
      {edit && <EditGrid dimensions={room.dimensions} />}
      {room.items.map((item) => {
        let content: React.ReactNode
        let selected: boolean
        if (item.device) {
          const key = deviceRefKey(item.device)
          const device = devices.get(key)
          const Asset = DEVICE_ASSETS[item.assetId as DeviceAssetId]
          if (!device || !Asset) return null
          selected = edit ? edit.selectedItemId === item.id : selectedKey === key
          content = <Asset device={device} isSelected={selected} onClick={() => (edit ? edit.onSelectItem(item.id) : onSelect(key))} />
        } else {
          const Furniture = FURNITURE[item.assetId as FurnitureAssetId]
          if (!Furniture) return null
          selected = edit?.selectedItemId === item.id
          content = <Furniture />
        }
        return edit ? (
          <EditablePlaced key={item.id} item={item} room={room} roomGroup={groupRef} selected={selected} edit={edit}>
            {content}
          </EditablePlaced>
        ) : (
          <Placed key={item.id} item={item}>{content}</Placed>
        )
      })}
      <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={Math.max(width, depth)} blur={2.4} far={4} />
    </group>
  )
}

/** Afasta a camera inicial em comodos maiores que a sala padrao. */
function cameraPosition(dimensions: RoomDimensions, target: Vec3): Vec3 {
  const factor = Math.max(1, dimensions.width / 8, dimensions.depth / 7)
  return [target[0] + 4.4 * factor, target[1] + 3 * factor, target[2] + 4.7 * factor]
}

export function RoomScene({ room, devices, selectedKey, onSelect, edit }: RoomSceneProps) {
  const target = useMemo(() => cameraTarget(room.dimensions), [room.dimensions])
  // So na montagem: redimensionar no editor nao tira a camera de onde o usuario deixou.
  const [initialCamera] = useState(() => cameraPosition(room.dimensions, target))
  const lightsOn = room.items.filter((item) => {
    const device = item.device && devices.get(deviceRefKey(item.device))
    return device?.kind === 'light' && device.state.power
  }).length

  return (
    <div className="room-canvas-wrap">
      {/* Absoluto: o tamanho vem do card, nunca do canvas. Em fluxo, a altura
          do canvas realimentava o layout e crescia ao maximizar a janela. */}
      <Canvas
        style={{ position: 'absolute', inset: 0 }}
        shadows
        camera={{ position: initialCamera, fov: 42, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
        onPointerMissed={() => edit?.onSelectItem(null)}
      >
        <SoftShadows size={26} samples={12} focus={0.6} />
        <color attach="background" args={['#0b0f1a']} />
        <fog attach="fog" args={['#0b0f1a', 12, 30]} />
        <Atmosphere lightsOn={lightsOn} target={target} />
        <SceneContent room={room} devices={devices} selectedKey={selectedKey} onSelect={onSelect} edit={edit} />
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={4}
          maxDistance={18}
          minPolarAngle={Math.PI / 7}
          maxPolarAngle={Math.PI / 2.15}
          target={target}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
    </div>
  )
}
