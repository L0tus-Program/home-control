import * as THREE from 'three'
import { useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, ContactShadows, SoftShadows } from '@react-three/drei'
import { deviceKey } from '../../../../../shared/devices'
import type { Device } from '../../../../../shared/types'
import { AC_MOUNTS, CAMERA_TARGET, LIGHT_SPOTS, ROOM, type Vec3 } from '../layout'
import { Floor } from './Floor'
import { Furniture } from './Furniture'
import { LightDevice } from './LightDevice'
import { ACDevice } from './ACDevice'

interface RoomSceneProps {
  devices: Device[]
  selectedKey: string | null
  onSelect: (key: string) => void
}

/** Iluminacao ambiente com leve respiracao, para dar vida a cena. */
function Atmosphere({ lightsOn }: { lightsOn: number }) {
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
      {lightsOn > 0 && <pointLight position={[CAMERA_TARGET[0], ROOM.wallHeight - 0.4, CAMERA_TARGET[2]]} intensity={lightsOn * 0.6} color="#ffd9a0" distance={14} decay={2} />}
    </>
  )
}

/** Posicionamento fixo e curado: cada aparelho tem um lugar na sala. */
function layoutFor(devices: Device[]): { device: Device; position: Vec3; rotationY: number }[] {
  const lights = devices.filter((d) => d.kind === 'light')
  const acs = devices.filter((d) => d.kind === 'air-conditioner')
  return [
    ...lights.map((device, i) => ({ device, position: LIGHT_SPOTS[i % LIGHT_SPOTS.length], rotationY: 0 })),
    ...acs.map((device, i) => ({ device, ...AC_MOUNTS[i % AC_MOUNTS.length] }))
  ]
}

function SceneContent({ devices, selectedKey, onSelect }: RoomSceneProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [intro, setIntro] = useState(true)

  const placed = useMemo(() => layoutFor(devices), [devices])

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
      <Floor />
      <Furniture />
      {placed.map(({ device, position, rotationY }) =>
        device.kind === 'light' ? (
          <LightDevice
            key={deviceKey(device)}
            device={device}
            position={position}
            isSelected={selectedKey === deviceKey(device)}
            onClick={() => onSelect(deviceKey(device))}
          />
        ) : (
          <ACDevice
            key={deviceKey(device)}
            device={device}
            position={position}
            rotationY={rotationY}
            isSelected={selectedKey === deviceKey(device)}
            onClick={() => onSelect(deviceKey(device))}
          />
        )
      )}
      <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={Math.max(ROOM.width, ROOM.depth)} blur={2.4} far={4} />
    </group>
  )
}

export function RoomScene({ devices, selectedKey, onSelect }: RoomSceneProps) {
  return (
    <div className="room-canvas-wrap">
      <Canvas
        shadows
        camera={{ position: [4.4, 3.9, 3.6], fov: 42, near: 0.1, far: 80 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
      >
        <SoftShadows size={26} samples={12} focus={0.6} />
        <color attach="background" args={['#0b0f1a']} />
        <fog attach="fog" args={['#0b0f1a', 12, 30]} />
        <Atmosphere lightsOn={devices.filter((d) => d.kind === 'light' && d.state.power).length} />
        <SceneContent devices={devices} selectedKey={selectedKey} onSelect={onSelect} />
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={4}
          maxDistance={15}
          minPolarAngle={Math.PI / 7}
          maxPolarAngle={Math.PI / 2.15}
          target={CAMERA_TARGET}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
    </div>
  )
}
