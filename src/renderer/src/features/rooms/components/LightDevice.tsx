import * as THREE from 'three'
import { useRef, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Device } from '../../../../../shared/types'

interface LightDeviceProps {
  device: Device
  position: [number, number, number]
  isSelected: boolean
  onClick: () => void
}

/** Converte hue/saturacao (0-360, 0-100) do modelo Tuya para hex. */
function hslToHex(hue: number, sat: number, light = 60): string {
  const c = new THREE.Color()
  c.setHSL(hue / 360, sat / 100, light / 100)
  return `#${c.getHexString()}`
}

export function LightDevice({ device, position, isSelected, onClick }: LightDeviceProps) {
  const groupRef = useRef<THREE.Group>(null)
  const bulbRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  const isOn = device.state.power
  const brightness = device.state.brightness ?? 100
  const color = device.state.color ? hslToHex(device.state.color.hue, device.state.color.saturation) : '#ffca7a'

  const haloTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 128
    canvas.height = 128
    const ctx = canvas.getContext('2d')!
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(0.35, 'rgba(255,240,210,0.35)')
    grad.addColorStop(1, 'rgba(255,240,210,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(canvas)
  }, [])

  useFrame(({ clock }) => {
    if (groupRef.current) {
      const target = isSelected ? 1.12 : hovered ? 1.06 : 1
      const s = THREE.MathUtils.lerp(groupRef.current.scale.x, target, 0.12)
      groupRef.current.scale.setScalar(s)
    }
    if (bulbRef.current && isOn) {
      const pulse = 1 + Math.sin(clock.getElapsedTime() * 2.4) * 0.04
      bulbRef.current.scale.setScalar(pulse)
    }
  })

  return (
    <group
      ref={groupRef}
      position={position}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHovered(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHovered(false)
        document.body.style.cursor = 'auto'
      }}
    >
      {/* Base */}
      <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.2, 0.26, 0.1, 32]} />
        <meshStandardMaterial color="#232b36" metalness={0.55} roughness={0.35} />
      </mesh>

      {/* Haste */}
      <mesh position={[0, 0.55, 0]} castShadow>
        <cylinderGeometry args={[0.028, 0.028, 0.95, 16]} />
        <meshStandardMaterial color="#3a4656" metalness={0.5} roughness={0.4} />
      </mesh>

      {/* Cupula */}
      <mesh position={[0, 1.18, 0]} castShadow>
        <coneGeometry args={[0.58, 0.72, 64, 1, true]} />
        <meshStandardMaterial color="#f3efe6" side={THREE.DoubleSide} roughness={0.55} />
      </mesh>

      {/* Lampada */}
      <mesh ref={bulbRef} position={[0, 0.95, 0]}>
        <sphereGeometry args={[0.15, 32, 32]} />
        <meshStandardMaterial
          color={isOn ? color : '#4a4a4a'}
          emissive={isOn ? color : '#000000'}
          emissiveIntensity={isOn ? 1.4 + (brightness / 100) * 1.6 : 0}
          toneMapped={false}
        />
      </mesh>

      {/* Halo no piso */}
      {isOn && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <planeGeometry args={[3.2 * (brightness / 100 + 0.4), 3.2 * (brightness / 100 + 0.4)]} />
          <meshBasicMaterial
            map={haloTexture}
            transparent
            opacity={0.5 * (brightness / 100 + 0.3)}
            color={color}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}

      {/* Luz real na cena */}
      {isOn && (
        <pointLight
          position={[0, 1.0, 0]}
          color={color}
          intensity={5 + (brightness / 100) * 7}
          distance={9}
          decay={2}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
      )}

      {/* Anel de selecao */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.52, 0.6, 64]} />
          <meshBasicMaterial color="#5ec8ff" transparent opacity={0.85} />
        </mesh>
      )}

      {/* Tooltip 3D */}
      {(isSelected || hovered) && (
        <Html position={[0, 1.9, 0]} center distanceFactor={11} zIndexRange={[10, 0]}>
          <div className="room3d-tooltip">
            <strong>{device.name}</strong>
            <span>{isOn ? `${Math.round(brightness)}% · acesa` : 'apagada'}</span>
          </div>
        </Html>
      )}
    </group>
  )
}
