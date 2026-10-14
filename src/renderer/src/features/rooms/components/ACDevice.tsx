import * as THREE from 'three'
import { useRef, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Device } from '../../../../../shared/types'

interface ACDeviceProps {
  device: Device
  position: [number, number, number]
  isSelected: boolean
  onClick: () => void
}

const MODE_COLORS: Record<string, string> = {
  cool: '#4fc3f7',
  heat: '#ff8a65',
  dry: '#81c784',
  fan: '#b0bec5',
  auto: '#9fa8ff'
}

export function ACDevice({ device, position, isSelected, onClick }: ACDeviceProps) {
  const groupRef = useRef<THREE.Group>(null)
  const flapRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)

  const isOn = device.state.power
  const temp = device.state.temperature ?? 24
  const mode = device.state.mode ?? 'cool'
  const modeColor = MODE_COLORS[mode] ?? '#9fa8ff'

  const particles = useMemo(
    () =>
      Array.from({ length: 36 }).map((_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 1.5,
        z: (Math.random() - 0.5) * 0.5,
        phase: Math.random() * Math.PI * 2,
        speed: 0.35 + Math.random() * 0.3
      })),
    []
  )
  const particleRefs = useRef<(THREE.Mesh | null)[]>([])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    if (groupRef.current) {
      const target = isSelected ? 1.08 : hovered ? 1.04 : 1
      const s = THREE.MathUtils.lerp(groupRef.current.scale.x, target, 0.12)
      groupRef.current.scale.setScalar(s)
    }
    if (flapRef.current) {
      flapRef.current.rotation.x = isOn ? Math.PI / 7 + Math.sin(t * 1.8) * 0.06 : 0
    }
    particleRefs.current.forEach((mesh, i) => {
      if (!mesh) return
      const p = particles[i]
      const cycle = ((t * p.speed + p.phase) % 3) / 3
      mesh.position.set(p.x + Math.sin(t + p.phase) * 0.12, -0.35 - cycle * 2.4, p.z + cycle * 0.6)
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.opacity = isOn ? Math.sin(cycle * Math.PI) * 0.45 : 0
    })
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
      {/* Corpo da unidade */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2.3, 0.62, 0.42]} />
        <meshStandardMaterial color="#f4f6f8" roughness={0.35} metalness={0.12} />
      </mesh>

      {/* Faixa frontal */}
      <mesh position={[0, 0.06, 0.215]}>
        <boxGeometry args={[2.0, 0.32, 0.02]} />
        <meshStandardMaterial color="#e6eaee" roughness={0.28} metalness={0.06} />
      </mesh>

      {/* Display */}
      <mesh position={[0.62, 0.06, 0.225]}>
        <planeGeometry args={[0.52, 0.2]} />
        <meshBasicMaterial color={isOn ? modeColor : '#1c2128'} toneMapped={false} />
      </mesh>

      {/* Texto do display */}
      <Html position={[0.62, 0.06, 0.235]} transform distanceFactor={6} zIndexRange={[10, 0]}>
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            color: isOn ? '#0b0f1a' : '#3a4149',
            textAlign: 'center',
            width: '44px',
            pointerEvents: 'none',
            userSelect: 'none'
          }}
        >
          {isOn ? `${Math.round(temp)}°` : '—'}
        </div>
      </Html>

      {/* Grade + flap */}
      <mesh position={[0, -0.16, 0.215]}>
        <boxGeometry args={[1.9, 0.07, 0.02]} />
        <meshStandardMaterial color="#d7dce1" roughness={0.5} />
      </mesh>
      <mesh ref={flapRef} position={[0, -0.24, 0.24]}>
        <boxGeometry args={[1.9, 0.035, 0.26]} />
        <meshStandardMaterial color="#c8ced4" roughness={0.4} metalness={0.1} />
      </mesh>

      {/* Particulas de ar frio/quente */}
      {particles.map((p, i) => (
        <mesh
          key={p.id}
          ref={(el) => {
            particleRefs.current[i] = el
          }}
          position={[p.x, -0.4, p.z]}
        >
          <sphereGeometry args={[0.022, 8, 8]} />
          <meshBasicMaterial color={modeColor} transparent opacity={0} depthWrite={false} />
        </mesh>
      ))}

      {/* Anel de selecao no piso, abaixo da unidade */}
      {isSelected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -3.05, 0.4]}>
          <ringGeometry args={[1.1, 1.18, 64]} />
          <meshBasicMaterial color="#5ec8ff" transparent opacity={0.85} />
        </mesh>
      )}

      {/* Tooltip 3D */}
      {(isSelected || hovered) && (
        <Html position={[0, 0.75, 0]} center distanceFactor={11} zIndexRange={[10, 0]}>
          <div className="room3d-tooltip">
            <strong>{device.name}</strong>
            <span>{isOn ? `${mode} · ${Math.round(temp)}°C` : 'desligado'}</span>
          </div>
        </Html>
      )}
    </group>
  )
}
