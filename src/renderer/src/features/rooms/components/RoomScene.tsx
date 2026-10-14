import * as THREE from 'three'
import { useMemo, useRef, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, ContactShadows, SoftShadows } from '@react-three/drei'
import type { Device } from '../../../../../shared/types'
import { Floor } from './Floor'
import { Furniture } from './Furniture'
import { LightDevice } from './LightDevice'
import { ACDevice } from './ACDevice'

interface RoomSceneProps {
  devices: Device[]
  selectedKey: string | null
  onSelect: (key: string) => void
}

function deviceKey(device: Device): string {
  return `${device.driverId}:${device.id}`
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
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />
      {/* Brilho extra quando ha lampadas acesas */}
      {lightsOn > 0 && <pointLight position={[0, 3.5, 0]} intensity={lightsOn * 0.6} color="#ffd9a0" distance={14} decay={2} />}
    </>
  )
}

/** Posicionamento fixo e curado: cada aparelho tem um lugar na sala. */
function layoutFor(devices: Device[]): { device: Device; position: [number, number, number] }[] {
  const lights = devices.filter((d) => d.kind === 'light')
  const acs = devices.filter((d) => d.kind === 'air-conditioner')
  const out: { device: Device; position: [number, number, number] }[] = []

  // Lampadas espalhadas pelo piso (abajures/pontos de luz)
  const lightSpots: [number, number, number][] = [
    [-3.2, 0, 1.8],
    [2.8, 0, 2.6],
    [0.6, 0, -3.4],
    [-4.5, 0, -2.2]
  ]
  lights.forEach((device, i) => {
    out.push({ device, position: lightSpots[i % lightSpots.length] })
  })

  // Ar-condicionado na parede de fundo, acima da janela
  acs.forEach((device, i) => {
    out.push({ device, position: [-2.5 + i * 5, 3.1, -8.55] })
  })

  return out
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
      {placed.map(({ device, position }) =>
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
            isSelected={selectedKey === deviceKey(device)}
            onClick={() => onSelect(deviceKey(device))}
          />
        )
      )}
      <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={20} blur={2.4} far={4} />
    </group>
  )
}

export function RoomScene({ devices, selectedKey, onSelect }: RoomSceneProps) {
  return (
    <div className="room-canvas-wrap">
      <Canvas
        shadows
        camera={{ position: [9, 7, 11], fov: 42, near: 0.1, far: 120 }}
        gl={{ antialias: true, alpha: false }}
        dpr={[1, 2]}
      >
        <SoftShadows size={26} samples={12} focus={0.6} />
        <color attach="background" args={['#0b0f1a']} />
        <fog attach="fog" args={['#0b0f1a', 18, 42]} />
        <Atmosphere lightsOn={devices.filter((d) => d.kind === 'light' && d.state.power).length} />
        <SceneContent devices={devices} selectedKey={selectedKey} onSelect={onSelect} />
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={6}
          maxDistance={24}
          minPolarAngle={Math.PI / 7}
          maxPolarAngle={Math.PI / 2.15}
          target={[0, 1.4, 0]}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
    </div>
  )
}
