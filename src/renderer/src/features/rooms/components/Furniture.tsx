import * as THREE from 'three'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import { useCanvasTexture } from '../hooks'
import { BACK_WALL_Z, LEFT_WALL_X, ROOM, type Vec3 } from '../layout'

const SOFA = {
  frame: '#4a5a6b',
  fabric: '#5d6d7e',
  legs: 0.06,
  baseTop: 0.38,
  arm: { width: 0.18, height: 0.62 },
  back: { thickness: 0.2, height: 0.88 },
  seatCushion: 0.14,
  backCushion: { height: 0.42, thickness: 0.16 }
}

/** Ruido deterministico: a cena fica igual a cada render e a cada montagem. */
function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function drawRug(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = '#e6ded3'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(80,60,50,${0.05 + noise(i) * 0.08})`
    ctx.lineWidth = 2 + noise(i + 100) * 3
    ctx.beginPath()
    const x = noise(i + 200) * size
    ctx.moveTo(x, 0)
    ctx.lineTo(x + (noise(i + 300) - 0.5) * 40, size)
    ctx.stroke()
  }
}

interface SofaBlockProps {
  /** Centro da peca no piso. A peca olha para +z. */
  position: Vec3
  width: number
  depth: number
  seats: number
  back?: boolean
  armLeft?: boolean
  armRight?: boolean
}

/**
 * Um modulo de sofa com base, bracos, encosto e almofadas apoiados uns nos
 * outros. Dois modulos lado a lado formam o L.
 */
function SofaBlock({ position, width, depth, seats, back = false, armLeft = false, armRight = false }: SofaBlockProps) {
  const { arm, legs, baseTop, seatCushion, backCushion } = SOFA
  const left = -width / 2 + (armLeft ? arm.width : 0)
  const right = width / 2 - (armRight ? arm.width : 0)
  const rear = -depth / 2 + (back ? SOFA.back.thickness : 0)
  const seatWidth = (right - left) / seats
  const seatTop = baseTop + seatCushion

  return (
    <group position={position}>
      {/* Pes */}
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
        <mesh key={`${sx}${sz}`} position={[sx * (width / 2 - 0.08), legs / 2, sz * (depth / 2 - 0.08)]}>
          <cylinderGeometry args={[0.03, 0.025, legs, 12]} />
          <meshStandardMaterial color="#2b2118" roughness={0.5} />
        </mesh>
      )))}
      {/* Base */}
      <mesh position={[0, (legs + baseTop) / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, baseTop - legs, depth]} />
        <meshStandardMaterial color={SOFA.fabric} roughness={0.85} />
      </mesh>
      {back && (
        <mesh position={[0, (baseTop + SOFA.back.height) / 2, -depth / 2 + SOFA.back.thickness / 2]} castShadow receiveShadow>
          <boxGeometry args={[width, SOFA.back.height - baseTop, SOFA.back.thickness]} />
          <meshStandardMaterial color={SOFA.frame} roughness={0.85} />
        </mesh>
      )}
      {[armLeft && -1, armRight && 1].filter((side): side is number => side !== false).map((side) => (
        <mesh key={side} position={[side * (width / 2 - arm.width / 2), (legs + arm.height) / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[arm.width, arm.height - legs, depth]} />
          <meshStandardMaterial color={SOFA.frame} roughness={0.85} />
        </mesh>
      ))}
      {Array.from({ length: seats }, (_, i) => {
        const x = left + seatWidth * (i + 0.5)
        return (
          <group key={i}>
            <RoundedBox args={[seatWidth - 0.02, seatCushion, depth / 2 - rear - 0.01]} radius={0.04} smoothness={3}
              position={[x, baseTop + seatCushion / 2, (rear + depth / 2) / 2]} castShadow receiveShadow>
              <meshStandardMaterial color="#aeb6bf" roughness={0.9} />
            </RoundedBox>
            {back && (
              <RoundedBox args={[seatWidth - 0.04, backCushion.height, backCushion.thickness]} radius={0.06} smoothness={3}
                position={[x, seatTop + backCushion.height / 2, rear + backCushion.thickness / 2]} castShadow receiveShadow>
                <meshStandardMaterial color={i % 2 === 0 ? '#d5dbdb' : '#c4cbcf'} roughness={0.9} />
              </RoundedBox>
            )}
          </group>
        )
      })}
    </group>
  )
}

/** Sofa em L encostado na parede do fundo, com a chaise saindo pela esquerda. */
function Sofa() {
  const width = 2.4
  const depth = 0.95
  const right = 0
  const backZ = BACK_WALL_Z + 0.04
  const frontZ = backZ + depth
  const chaise = { width: 0.85, length: 1.6 }
  const left = right - width
  return (
    <group>
      <SofaBlock position={[left + width / 2, 0, backZ + depth / 2]} width={width} depth={depth} seats={3} back armLeft armRight />
      <SofaBlock position={[left + chaise.width / 2, 0, frontZ + chaise.length / 2]} width={chaise.width}
        depth={chaise.length} seats={1} armLeft />
    </group>
  )
}

function CoffeeTable() {
  const height = 0.4
  return (
    <group position={[-0.6, 0, BACK_WALL_Z + 1.95]}>
      <mesh position={[0, height - 0.02, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.5, 0.5, 0.04, 64]} />
        <meshStandardMaterial color="#3e2723" roughness={0.3} metalness={0.1} />
      </mesh>
      <mesh position={[0, (height - 0.04) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, height - 0.04, 24]} />
        <meshStandardMaterial color="#281a16" roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.015, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.24, 0.28, 0.03, 32]} />
        <meshStandardMaterial color="#281a16" roughness={0.4} />
      </mesh>
      {/* Livro e caneca sobre o tampo */}
      <mesh position={[0.12, height + 0.025, 0.05]} rotation={[0, 0.4, 0]} castShadow>
        <boxGeometry args={[0.3, 0.05, 0.22]} />
        <meshStandardMaterial color="#c0392b" roughness={0.7} />
      </mesh>
      <mesh position={[-0.2, height + 0.05, -0.12]} castShadow>
        <cylinderGeometry args={[0.045, 0.04, 0.1, 20]} />
        <meshStandardMaterial color="#eceff1" roughness={0.4} />
      </mesh>
    </group>
  )
}

const BOOK_COLORS = ['#c0392b', '#2980b9', '#27ae60', '#d4a017', '#7d5ba6', '#34495e', '#e67e22']

/** Estante aberta encostada na parede esquerda, com livros apoiados nas prateleiras. */
function Bookshelf() {
  const width = 1.6
  const height = 2.0
  const depth = 0.36
  const t = 0.04
  const levels = 4
  const gap = (height - 2 * t) / levels
  const wood = <meshStandardMaterial color="#5d4037" roughness={0.55} />

  const books = useMemo(() => {
    const out: { position: Vec3; size: Vec3; color: string }[] = []
    for (let level = 0; level < levels; level++) {
      const floorY = t + level * gap + (level > 0 ? t / 2 : 0)
      let x = -width / 2 + t + 0.06
      const limit = level % 2 === 0 ? width / 2 - t - 0.06 : 0.1
      for (let i = 0; x < limit; i++) {
        const seed = level * 31 + i
        const w = 0.04 + noise(seed) * 0.05
        const h = Math.min(gap - t - 0.04, 0.24 + noise(seed + 7) * 0.14)
        if (x + w > limit) break
        out.push({
          position: [x + w / 2, floorY + h / 2, -depth / 2 + t + 0.13],
          size: [w, h, 0.22],
          color: BOOK_COLORS[Math.floor(noise(seed + 13) * BOOK_COLORS.length)]
        })
        x += w + 0.006
      }
    }
    return out
  }, [gap])

  return (
    <group position={[LEFT_WALL_X + depth / 2, 0, BACK_WALL_Z + 4.8]} rotation={[0, Math.PI / 2, 0]}>
      <mesh position={[0, height / 2, -depth / 2 + t / 2]} castShadow receiveShadow>
        <boxGeometry args={[width, height, t]} />
        {wood}
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (width / 2 - t / 2), height / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[t, height, depth]} />
          <meshStandardMaterial color="#3e2723" roughness={0.5} />
        </mesh>
      ))}
      {Array.from({ length: levels + 1 }, (_, level) => (
        <mesh key={level} position={[0, level === levels ? height - t / 2 : t / 2 + level * gap, 0]} castShadow receiveShadow>
          <boxGeometry args={[width - 2 * t, t, depth]} />
          {wood}
        </mesh>
      ))}
      {books.map((book, i) => (
        <mesh key={i} position={book.position} castShadow>
          <boxGeometry args={book.size} />
          <meshStandardMaterial color={book.color} roughness={0.7} />
        </mesh>
      ))}
      {/* Vaso nos nichos sem livros */}
      {[1, 3].map((level) => (
        <mesh key={level} position={[0.42, t / 2 + level * gap + t / 2 + 0.1, 0]} castShadow>
          <cylinderGeometry args={[0.07, 0.09, 0.2, 20]} />
          <meshStandardMaterial color={level === 1 ? '#d7ccc8' : '#90a4ae'} roughness={0.4} />
        </mesh>
      ))}
    </group>
  )
}

/** Planta no canto, ao lado da janela. As folhas sao fixas para nao pular a cada render. */
function Plant() {
  const plantRef = useRef<THREE.Group>(null)
  const potHeight = 0.5
  const leaves = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        angle: (i / 18) * Math.PI * 2,
        radius: 0.05 + noise(i) * 0.12,
        height: 0.6 + noise(i + 50) * 0.5,
        tilt: 0.15 + noise(i + 90) * 0.35
      })),
    []
  )

  useFrame(({ clock }) => {
    if (plantRef.current) plantRef.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.2) * 0.03
  })

  return (
    <group ref={plantRef} position={[ROOM.width / 2 - 0.45, 0, BACK_WALL_Z + 0.55]}>
      <mesh position={[0, potHeight / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.28, 0.21, potHeight, 32]} />
        <meshStandardMaterial color="#8d6e63" roughness={0.8} />
      </mesh>
      <mesh position={[0, potHeight - 0.03, 0]} receiveShadow>
        <cylinderGeometry args={[0.26, 0.26, 0.02, 32]} />
        <meshStandardMaterial color="#4e342e" roughness={0.95} />
      </mesh>
      {leaves.map((leaf, i) => (
        <group key={i} rotation={[0, leaf.angle, 0]}>
          <group position={[leaf.radius, potHeight - 0.03, 0]} rotation={[0, 0, -leaf.tilt]}>
            <mesh position={[0, leaf.height / 2, 0]} castShadow>
              <coneGeometry args={[0.07, leaf.height, 10]} />
              <meshStandardMaterial color={i % 2 === 0 ? '#2e7d32' : '#388e3c'} roughness={0.8} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  )
}

export function Furniture() {
  const rugTexture = useCanvasTexture(512, drawRug, [1.5, 1])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.9, 0.005, BACK_WALL_Z + 1.7]} receiveShadow>
        <planeGeometry args={[3.6, 2.6]} />
        <meshStandardMaterial map={rugTexture} roughness={0.95} color="#f0ebe3" />
      </mesh>
      <Sofa />
      <CoffeeTable />
      <Bookshelf />
      <Plant />
    </group>
  )
}
