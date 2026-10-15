import * as THREE from 'three'
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Device } from '../../../../../shared/types'
import { whiteTone } from '../../../lightTone'
import { useCanvasTexture, useHoverCursor } from '../hooks'

interface LightDeviceProps {
  device: Device
  isSelected: boolean
  onClick: () => void
}

/** Abajur de piso, em metros: cupula de 0,8 m de diametro a ~1,5 m do chao. */
const LAMP = {
  stemHeight: 1.1,
  shade: { radius: 0.4, height: 0.5, y: 1.3 },
  bulb: { radius: 0.11, y: 1.1 }
}

/** Converte hue/saturacao (0-360, 0-100) do modelo Tuya para hex. */
function hslToHex(hue: number, sat: number, light = 60): string {
  const c = new THREE.Color()
  c.setHSL(hue / 360, sat / 100, light / 100)
  return `#${c.getHexString()}`
}

function drawHalo(ctx: CanvasRenderingContext2D, size: number): void {
  const half = size / 2
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(0.35, 'rgba(255,240,210,0.35)')
  grad.addColorStop(1, 'rgba(255,240,210,0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)
}

export function LightDevice({ device, isSelected, onClick }: LightDeviceProps) {
  const groupRef = useRef<THREE.Group>(null)
  const bulbRef = useRef<THREE.Mesh>(null)
  const { hovered, onPointerOver, onPointerOut } = useHoverCursor()
  const haloTexture = useCanvasTexture(128, drawHalo)

  const isOn = device.state.power
  const brightness = device.state.brightness ?? 100
  // Em modo branco, a luz da maquete segue o tom; sem tom, o branco quente de sempre.
  const tone = device.state.colorTemperature
  const color = device.state.color ? hslToHex(device.state.color.hue, device.state.color.saturation) : tone === undefined ? '#ffca7a' : whiteTone(tone)
  const haloSize = 2.6 * (brightness / 100 + 0.4)

  useFrame(({ clock }) => {
    if (groupRef.current) {
      const target = isSelected ? 1.08 : hovered ? 1.04 : 1
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
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      {/* Base */}
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.16, 0.2, 0.08, 32]} />
        <meshStandardMaterial color="#232b36" metalness={0.55} roughness={0.35} />
      </mesh>

      {/* Haste: da base ate dentro da cupula */}
      <mesh position={[0, 0.08 + LAMP.stemHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[0.022, 0.022, LAMP.stemHeight, 16]} />
        <meshStandardMaterial color="#3a4656" metalness={0.5} roughness={0.4} />
      </mesh>

      {/* Cupula */}
      <mesh position={[0, LAMP.shade.y, 0]} castShadow>
        <coneGeometry args={[LAMP.shade.radius, LAMP.shade.height, 64, 1, true]} />
        <meshStandardMaterial color="#f3efe6" side={THREE.DoubleSide} roughness={0.55} />
      </mesh>

      {/* Lampada */}
      <mesh ref={bulbRef} position={[0, LAMP.bulb.y, 0]}>
        <sphereGeometry args={[LAMP.bulb.radius, 32, 32]} />
        <meshStandardMaterial
          color={isOn ? color : '#4a4a4a'}
          emissive={isOn ? color : '#000000'}
          emissiveIntensity={isOn ? 1.4 + (brightness / 100) * 1.6 : 0}
          toneMapped={false}
        />
      </mesh>

      {/* Halo no piso */}
      {isOn && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
          <planeGeometry args={[haloSize, haloSize]} />
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
          position={[0, LAMP.bulb.y, 0]}
          color={color}
          intensity={4 + (brightness / 100) * 6}
          distance={7}
          decay={2}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
      )}

      {/* Anel de selecao */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
          <ringGeometry args={[0.36, 0.42, 64]} />
          <meshBasicMaterial color="#5ec8ff" transparent opacity={0.85} />
        </mesh>
      )}

      {/* Tooltip 3D */}
      {(isSelected || hovered) && (
        <Html position={[0, LAMP.shade.y + 0.55, 0]} center distanceFactor={8} zIndexRange={[10, 0]}>
          <div className="room3d-tooltip">
            <strong>{device.name}</strong>
            <span>{isOn ? `${Math.round(brightness)}% · acesa` : 'apagada'}</span>
          </div>
        </Html>
      )}
    </group>
  )
}
