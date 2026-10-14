import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'

function Cushion({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={[0.85, 0.85, 0.35]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  )
}

export function Furniture() {
  const plantRef = useRef<THREE.Group>(null)

  const rugTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#e6ded3'
    ctx.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(80,60,50,${0.05 + Math.random() * 0.08})`
      ctx.lineWidth = 2 + Math.random() * 3
      ctx.beginPath()
      const x = Math.random() * 512
      ctx.moveTo(x, 0)
      ctx.lineTo(x + (Math.random() - 0.5) * 40, 512)
      ctx.stroke()
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(2, 2)
    return tex
  }, [])

  useFrame(({ clock }) => {
    if (plantRef.current) {
      plantRef.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.2) * 0.03
    }
  })

  return (
    <group>
      {/* Tapete */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <planeGeometry args={[8, 5.5]} />
        <meshStandardMaterial map={rugTexture} roughness={0.95} color="#f0ebe3" />
      </mesh>

      {/* Sofá em L */}
      <group position={[-4.5, 0.45, -2]}>
        {/* Base principal */}
        <mesh position={[0, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[3.6, 0.9, 1.4]} />
          <meshStandardMaterial color="#5d6d7e" roughness={0.85} />
        </mesh>
        {/* Encosto */}
        <mesh position={[0, 0.7, -0.55]} castShadow receiveShadow>
          <boxGeometry args={[3.6, 0.8, 0.3]} />
          <meshStandardMaterial color="#4a5a6b" roughness={0.85} />
        </mesh>
        {/* Braço esquerdo */}
        <mesh position={[-1.65, 0.35, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.3, 0.7, 1.4]} />
          <meshStandardMaterial color="#4a5a6b" roughness={0.85} />
        </mesh>
        {/* Braço direito */}
        <mesh position={[1.65, 0.35, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.3, 0.7, 1.4]} />
          <meshStandardMaterial color="#4a5a6b" roughness={0.85} />
        </mesh>
        {/* Almofadas */}
        <Cushion position={[-1, 0.55, -0.2]} color="#d5dbdb" />
        <Cushion position={[0, 0.55, -0.2]} color="#aeb6bf" />
        <Cushion position={[1, 0.55, -0.2]} color="#d5dbdb" />
      </group>

      {/* Chaise do sofá */}
      <group position={[-2.2, 0.45, 0.8]}>
        <mesh position={[0, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.4, 0.9, 2.4]} />
          <meshStandardMaterial color="#5d6d7e" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.7, -0.95]} castShadow receiveShadow>
          <boxGeometry args={[1.4, 0.8, 0.3]} />
          <meshStandardMaterial color="#4a5a6b" roughness={0.85} />
        </mesh>
        <Cushion position={[0, 0.55, -0.3]} color="#aeb6bf" />
        <Cushion position={[0, 0.55, 0.6]} color="#d5dbdb" />
      </group>

      {/* Mesa de centro */}
      <group position={[0, 0.35, 0.5]}>
        <mesh position={[0, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[1.1, 1.1, 0.08, 64]} />
          <meshStandardMaterial color="#3e2723" roughness={0.3} metalness={0.1} />
        </mesh>
        <mesh position={[0, -0.3, 0]} castShadow>
          <cylinderGeometry args={[0.12, 0.12, 0.6, 32]} />
          <meshStandardMaterial color="#281a16" roughness={0.4} />
        </mesh>
        <mesh position={[0, -0.62, 0]} castShadow>
          <cylinderGeometry args={[0.5, 0.6, 0.05, 32]} />
          <meshStandardMaterial color="#281a16" roughness={0.4} />
        </mesh>
      </group>

      {/* Estante */}
      <group position={[7.5, 2, -6]}>
        <mesh position={[0, 0, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.5, 4, 0.6]} />
          <meshStandardMaterial color="#3e2723" roughness={0.5} />
        </mesh>
        {[1.3, 0.4, -0.5, -1.4].map((y, i) => (
          <mesh key={i} position={[0, y, 0.05]} castShadow receiveShadow>
            <boxGeometry args={[2.3, 0.06, 0.5]} />
            <meshStandardMaterial color="#5d4037" roughness={0.5} />
          </mesh>
        ))}
        {/* Livros decorativos */}
        <mesh position={[-0.5, 1.65, 0.15]} castShadow>
          <boxGeometry args={[0.5, 0.5, 0.12]} />
          <meshStandardMaterial color="#c0392b" />
        </mesh>
        <mesh position={[-0.05, 1.65, 0.15]} castShadow>
          <boxGeometry args={[0.45, 0.6, 0.12]} />
          <meshStandardMaterial color="#2980b9" />
        </mesh>
        <mesh position={[0.4, 1.65, 0.15]} castShadow>
          <boxGeometry args={[0.4, 0.45, 0.12]} />
          <meshStandardMaterial color="#27ae60" />
        </mesh>
      </group>

      {/* Planta */}
      <group ref={plantRef} position={[6.5, 0, 4.5]}>
        <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.45, 0.35, 0.9, 32]} />
          <meshStandardMaterial color="#8d6e63" roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.95, 0]} castShadow receiveShadow>
          <sphereGeometry args={[0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#5d4037" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
        {Array.from({ length: 18 }).map((_, i) => {
          const angle = (i / 18) * Math.PI * 2
          const r = 0.25 + Math.random() * 0.25
          const h = 0.8 + Math.random() * 0.6
          return (
            <mesh
              key={i}
              position={[Math.cos(angle) * r, 1.1 + h / 2, Math.sin(angle) * r]}
              rotation={[0.3, angle, 0]}
              castShadow
            >
              <coneGeometry args={[0.12, h, 12]} />
              <meshStandardMaterial color={i % 2 === 0 ? '#2e7d32' : '#388e3c'} roughness={0.8} />
            </mesh>
          )
        })}
      </group>
    </group>
  )
}
