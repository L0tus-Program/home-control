import * as THREE from 'three'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import type { Device } from '../../../../../shared/types'
import { modeLabel } from '../../../labels'
import { useHoverCursor } from '../hooks'
import { AC_SCALE, type Vec3 } from '../layout'

interface ACDeviceProps {
  device: Device
  position: Vec3
  /** Giro em torno de y para encostar o fundo do aparelho na parede. */
  rotationY?: number
  isSelected: boolean
  onClick: () => void
}

/** Chaves nos valores que a ThinQ envia (COOL, HEAT, AIR_DRY...). */
const MODE_COLORS: Record<string, string> = {
  COOL: '#4fc3f7',
  HEAT: '#ff8a65',
  AIR_DRY: '#81c784',
  FAN: '#b0bec5',
  AUTO: '#9fa8ff'
}
const FALLBACK_COLOR = '#9fa8ff'

/** Textura do display, redesenhada quando muda o que ele mostra. */
function useDisplayTexture(text: string, background: string, color: string): THREE.CanvasTexture {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 208
    canvas.height = 80
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }, [])

  useEffect(() => {
    const canvas = texture.image as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = color
    ctx.font = '700 52px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 3)
    texture.needsUpdate = true
  }, [texture, text, background, color])

  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

/** Corpo do aparelho em unidades do modelo (antes de AC_SCALE). */
const BODY = { width: 2.3, height: 0.62, depth: 0.42 }

export function ACDevice({ device, position, rotationY = 0, isSelected, onClick }: ACDeviceProps) {
  const groupRef = useRef<THREE.Group>(null)
  const flapRef = useRef<THREE.Mesh>(null)
  const { hovered, onPointerOver, onPointerOut } = useHoverCursor()

  const isOn = device.state.power
  const temp = device.state.temperature ?? 24
  const mode = device.state.mode?.toUpperCase()
  const modeColor = (mode && MODE_COLORS[mode]) || FALLBACK_COLOR
  const display = useDisplayTexture(isOn ? `${Math.round(temp)}°` : '—', isOn ? modeColor : '#1c2128', isOn ? '#0b0f1a' : '#3a4149')

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
      const target = AC_SCALE * (isSelected ? 1.06 : hovered ? 1.03 : 1)
      groupRef.current.scale.setScalar(THREE.MathUtils.lerp(groupRef.current.scale.x, target, 0.12))
    }
    if (flapRef.current) {
      flapRef.current.rotation.x = isOn ? Math.PI / 7 + Math.sin(t * 1.8) * 0.06 : 0
    }
    particleRefs.current.forEach((mesh, i) => {
      if (!mesh) return
      const p = particles[i]
      const cycle = ((t * p.speed + p.phase) % 3) / 3
      mesh.position.set(p.x + Math.sin(t + p.phase) * 0.12, -0.35 - cycle * 2.4, BODY.depth / 2 + p.z * 0.4 + cycle * 0.9)
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.opacity = isOn ? Math.sin(cycle * Math.PI) * 0.45 : 0
    })
  })

  return (
    <group
      position={position}
      rotation={[0, rotationY, 0]}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      <group ref={groupRef} scale={AC_SCALE}>
        {/* Corpo da unidade. Nao projeta sombra: rente a parede, os abajures
            abaixo desenhariam um cone escuro subindo pela parede. */}
        <mesh receiveShadow>
          <boxGeometry args={[BODY.width, BODY.height, BODY.depth]} />
          <meshStandardMaterial color="#f4f6f8" roughness={0.35} metalness={0.12} />
        </mesh>

        {/* Contorno de selecao: casca um pouco maior, vista por dentro */}
        {isSelected && (
          <mesh>
            <boxGeometry args={[BODY.width + 0.12, BODY.height + 0.12, BODY.depth + 0.06]} />
            <meshBasicMaterial color="#5ec8ff" side={THREE.BackSide} transparent opacity={0.9} />
          </mesh>
        )}

        {/* Faixa frontal */}
        <mesh position={[0, 0.06, 0.215]}>
          <boxGeometry args={[2.0, 0.32, 0.02]} />
          <meshStandardMaterial color="#e6eaee" roughness={0.28} metalness={0.06} />
        </mesh>

        {/* Display com a temperatura desenhada nele mesmo */}
        <mesh position={[0.62, 0.06, 0.226]}>
          <planeGeometry args={[0.52, 0.2]} />
          <meshBasicMaterial map={display} toneMapped={false} />
        </mesh>

        {/* Grade + flap */}
        <mesh position={[0, -0.16, 0.215]}>
          <boxGeometry args={[1.9, 0.07, 0.02]} />
          <meshStandardMaterial color="#d7dce1" roughness={0.5} />
        </mesh>
        <mesh ref={flapRef} position={[0, -0.24, 0.24]}>
          <boxGeometry args={[1.9, 0.035, 0.26]} />
          <meshStandardMaterial color="#c8ced4" roughness={0.4} metalness={0.1} />
        </mesh>

        {/* Particulas de ar saindo para a frente da parede */}
        {particles.map((p, i) => (
          <mesh
            key={p.id}
            ref={(el) => {
              particleRefs.current[i] = el
            }}
            position={[p.x, -0.4, BODY.depth / 2]}
          >
            <sphereGeometry args={[0.022, 8, 8]} />
            <meshBasicMaterial color={modeColor} transparent opacity={0} depthWrite={false} />
          </mesh>
        ))}
      </group>

      {/* Tooltip 3D */}
      {(isSelected || hovered) && (
        <Html position={[0, 0.55, 0]} center distanceFactor={8} zIndexRange={[10, 0]}>
          <div className="room3d-tooltip">
            <strong>{device.name}</strong>
            <span>{isOn ? `${device.state.mode ? modeLabel(device.state.mode) : 'Ligado'} · ${Math.round(temp)}°C` : 'desligado'}</span>
          </div>
        </Html>
      )}
    </group>
  )
}
