import * as THREE from 'three'
import { useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, ContactShadows, SoftShadows } from '@react-three/drei'
import { deviceKey } from '../../../../../shared/devices'
import { deviceRefKey, type DeviceAssetId, type FurnitureAssetId, type Room, type RoomItem } from '../../../../../shared/home'
import type { Device } from '../../../../../shared/types'
import { cameraTarget, ROOM, type Vec3 } from '../layout'
import { Floor } from './Floor'
import { FURNITURE } from './Furniture'
import { LightDevice } from './LightDevice'
import { ACDevice } from './ACDevice'

interface RoomSceneProps {
  room: Room
  devices: Device[]
  selectedKey: string | null
  onSelect: (key: string) => void
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

function SceneContent({ room, devices, selectedKey, onSelect }: RoomSceneProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [intro, setIntro] = useState(true)
  const { width, depth } = room.dimensions

  const devicesByKey = useMemo(() => new Map(devices.map((device) => [deviceKey(device), device])), [devices])

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
      {room.items.map((item) => {
        if (!item.device) {
          const Furniture = FURNITURE[item.assetId as FurnitureAssetId]
          return Furniture && <Placed key={item.id} item={item}><Furniture /></Placed>
        }
        // Aparelho ainda nao carregado (ou fora da conta) nao e desenhado por enquanto.
        const key = deviceRefKey(item.device)
        const device = devicesByKey.get(key)
        const Asset = DEVICE_ASSETS[item.assetId as DeviceAssetId]
        if (!device || !Asset) return null
        return (
          <Placed key={item.id} item={item}>
            <Asset device={device} isSelected={selectedKey === key} onClick={() => onSelect(key)} />
          </Placed>
        )
      })}
      <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={Math.max(width, depth)} blur={2.4} far={4} />
    </group>
  )
}

export function RoomScene({ room, devices, selectedKey, onSelect }: RoomSceneProps) {
  const target = useMemo(() => cameraTarget(room.dimensions), [room.dimensions])
  return (
    <div className="room-canvas-wrap">
      {/* Absoluto: o tamanho vem do card, nunca do canvas. Em fluxo, a altura
          do canvas realimentava o layout e crescia ao maximizar a janela. */}
      <Canvas
        style={{ position: 'absolute', inset: 0 }}
        shadows
        camera={{ position: [4.4, 3.9, 3.6], fov: 42, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
      >
        <SoftShadows size={26} samples={12} focus={0.6} />
        <color attach="background" args={['#0b0f1a']} />
        <fog attach="fog" args={['#0b0f1a', 12, 30]} />
        <Atmosphere lightsOn={devices.filter((d) => d.kind === 'light' && d.state.power).length} target={target} />
        <SceneContent room={room} devices={devices} selectedKey={selectedKey} onSelect={onSelect} />
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={4}
          maxDistance={15}
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
