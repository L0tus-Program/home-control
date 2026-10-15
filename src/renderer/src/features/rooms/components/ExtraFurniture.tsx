import { RoundedBox } from '@react-three/drei'
import { FURNITURE_SIZES as F } from '../../../../../shared/home'
import type { Vec3 } from '../layout'
import { SofaBlock } from './Furniture'

/**
 * Moveis do catalogo alem da sala padrao. Cada peca e desenhada na origem,
 * apoiada no piso, com a frente para +z e o fundo para -z (onde fica a
 * parede quando encostada). As medidas vem de FURNITURE_SIZES.
 */

const WOOD = { light: '#c8a27a', mid: '#a0714f', dark: '#5d4037', walnut: '#6d4c41' }
const METAL = '#2b2f36'

interface BoxProps {
  size: Vec3
  position: Vec3
  color: string
  roughness?: number
  metalness?: number
  rotation?: Vec3
}

/** Caixa com sombra, a peca basica de quase todo movel. */
function Box({ size, position, color, roughness = 0.6, metalness = 0, rotation }: BoxProps) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  )
}

function Soft({ size, position, color, radius = 0.04, rotation }: BoxProps & { radius?: number }) {
  return (
    <RoundedBox args={size} radius={radius} smoothness={3} position={position} rotation={rotation} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.9} />
    </RoundedBox>
  )
}

/** Quatro pes nos cantos de uma caixa width × depth, recuados `inset`. */
function Legs({ width, depth, height, inset = 0.05, size = 0.045, color = WOOD.dark }: {
  width: number
  depth: number
  height: number
  inset?: number
  size?: number
  color?: string
}) {
  return (
    <>
      {[-1, 1].flatMap((sx) => [-1, 1].map((sz) => (
        <Box key={`${sx}${sz}`} size={[size, height, size]} color={color} roughness={0.5}
          position={[sx * (width / 2 - inset), height / 2, sz * (depth / 2 - inset)]} />
      )))}
    </>
  )
}

function Knob({ position }: { position: Vec3 }) {
  return (
    <mesh position={position} castShadow>
      <sphereGeometry args={[0.018, 12, 12]} />
      <meshStandardMaterial color="#d8c08f" metalness={0.6} roughness={0.3} />
    </mesh>
  )
}

// ── Sala ───────────────────────────────────────────────────────────────────

export function StraightSofa() {
  return <SofaBlock position={[0, 0, 0]} width={F.sofa.width} depth={F.sofa.depth} seats={3} back armLeft armRight />
}

export function Armchair() {
  return <SofaBlock position={[0, 0, 0]} width={F.armchair.width} depth={F.armchair.depth} seats={1} back armLeft armRight />
}

export function TvStand() {
  const { width, depth, height } = F.tvStand
  const leg = 0.08
  const screen = { width: 1.3, height: 0.76 }
  const screenY = height + 0.07 + screen.height / 2
  return (
    <group>
      <Legs width={width} depth={depth} height={leg} inset={0.08} size={0.04} color={METAL} />
      <Box size={[width, height - leg, depth]} position={[0, leg + (height - leg) / 2, 0]} color="#4e3b31" />
      {/* Portas: frisos e puxadores */}
      {[-width / 4, width / 4].map((x) => (
        <group key={x}>
          <Box size={[width / 2 - 0.03, height - leg - 0.06, 0.01]} position={[x, leg + (height - leg) / 2, depth / 2 + 0.005]} color="#5a4538" />
          <Box size={[0.12, 0.012, 0.012]} position={[x, height - 0.08, depth / 2 + 0.016]} color="#c9b48a" metalness={0.6} roughness={0.3} />
        </group>
      ))}
      {/* TV: pe, haste e tela */}
      <Box size={[0.36, 0.015, 0.2]} position={[0, height + 0.008, -0.04]} color={METAL} metalness={0.4} />
      <Box size={[0.05, 0.08, 0.03]} position={[0, height + 0.05, -0.06]} color={METAL} metalness={0.4} />
      <Box size={[screen.width, screen.height, 0.04]} position={[0, screenY, -0.06]} color="#111317" roughness={0.3} />
      <mesh position={[0, screenY, -0.039]}>
        <planeGeometry args={[screen.width - 0.04, screen.height - 0.04]} />
        <meshStandardMaterial color="#0f1726" emissive="#1c2c48" emissiveIntensity={0.35} roughness={0.15} metalness={0.2} />
      </mesh>
    </group>
  )
}

// ── Quarto ─────────────────────────────────────────────────────────────────

/** Cama com a cabeceira em -z: estrado, colchao, edredom e travesseiros. */
function Bed({ width, length, headboard, duvet }: { width: number; length: number; headboard: number; duvet: string }) {
  const leg = 0.08
  const frameTop = 0.32
  const mattress = 0.22
  const top = frameTop + mattress
  const duvetLength = length * 0.68
  const pillows = width > 1.2 ? 2 : 1
  const pillowWidth = (width - 0.2) / pillows - (pillows > 1 ? 0.06 : 0)
  return (
    <group>
      <Legs width={width} depth={length} height={leg} inset={0.06} size={0.06} />
      <Soft size={[width, frameTop - leg, length]} position={[0, leg + (frameTop - leg) / 2, 0]} color="#8d6e57" radius={0.03} />
      <Soft size={[width - 0.06, mattress, length - 0.06]} position={[0, frameTop + mattress / 2, 0]} color="#f3f1ec" radius={0.06} />
      {/* Edredom na parte da frente, com a dobra mais clara */}
      <Soft size={[width - 0.01, 0.07, duvetLength]} position={[0, top + 0.02, length / 2 - duvetLength / 2 - 0.01]} color={duvet} radius={0.03} />
      <Soft size={[width, 0.08, 0.18]} position={[0, top + 0.025, length / 2 - duvetLength + 0.08]} color="#ebe5da" radius={0.03} />
      {Array.from({ length: pillows }, (_, i) => (
        <Soft key={i} size={[pillowWidth, 0.12, 0.36]} radius={0.05} color="#fbfaf7"
          position={[pillows > 1 ? (i === 0 ? -1 : 1) * (pillowWidth / 2 + 0.03) : 0, top + 0.06, -length / 2 + 0.28]} />
      ))}
      {/* Cabeceira de madeira com painel estofado */}
      <Box size={[headboard, 1.05, 0.06]} position={[0, 0.525, -length / 2 - 0.03]} color={WOOD.walnut} />
      <Soft size={[headboard - 0.14, 0.42, 0.04]} position={[0, 0.8, -length / 2 + 0.01]} color="#b9a895" radius={0.02} />
    </group>
  )
}

export function BedDouble() {
  return <Bed {...F.bedDouble} duvet="#7f9cb8" />
}

export function BedSingle() {
  return <Bed width={F.bedSingle.width} length={F.bedSingle.length} headboard={F.bedSingle.headboard} duvet="#9db59a" />
}

export function Nightstand() {
  const { width, depth, height } = F.nightstand
  const leg = 0.1
  return (
    <group>
      <Legs width={width} depth={depth} height={leg} inset={0.04} size={0.035} />
      <Box size={[width, height - leg - 0.03, depth]} position={[0, leg + (height - leg - 0.03) / 2, 0]} color={WOOD.light} />
      <Box size={[width + 0.02, 0.03, depth + 0.02]} position={[0, height - 0.015, 0]} color={WOOD.mid} />
      <Box size={[width - 0.06, 0.006, 0.006]} position={[0, leg + (height - leg) * 0.55, depth / 2 + 0.003]} color={WOOD.dark} />
      <Knob position={[0, leg + (height - leg) * 0.75, depth / 2 + 0.015]} />
      <Knob position={[0, leg + (height - leg) * 0.3, depth / 2 + 0.015]} />
      {/* Livro e copo sobre o tampo */}
      <Box size={[0.2, 0.035, 0.14]} position={[-0.06, height + 0.018, 0.02]} rotation={[0, 0.3, 0]} color="#2980b9" roughness={0.7} />
      <mesh position={[0.14, height + 0.05, -0.08]} castShadow>
        <cylinderGeometry args={[0.03, 0.026, 0.1, 16]} />
        <meshStandardMaterial color="#e8f1f5" roughness={0.2} transparent opacity={0.8} />
      </mesh>
    </group>
  )
}

export function Wardrobe() {
  const { width, depth, height } = F.wardrobe
  const plinth = 0.07
  const front = depth / 2
  return (
    <group>
      <Box size={[width - 0.04, plinth, depth - 0.04]} position={[0, plinth / 2, 0]} color="#8f8577" />
      <Box size={[width, height - plinth, depth]} position={[0, plinth + (height - plinth) / 2, 0]} color="#ece6dc" roughness={0.5} />
      {/* Tres portas: frisos e puxadores verticais */}
      {[-width / 6, width / 6].map((x) => (
        <Box key={x} size={[0.008, height - plinth - 0.06, 0.006]} position={[x, plinth + (height - plinth) / 2, front + 0.003]} color="#b8afa2" />
      ))}
      {[-width / 6 - 0.06, width / 6 - 0.06, width / 6 + 0.06].map((x) => (
        <Box key={x} size={[0.018, 0.34, 0.018]} position={[x, 1.1, front + 0.02]} color="#c9b48a" metalness={0.6} roughness={0.3} />
      ))}
      <Box size={[width + 0.04, 0.04, depth + 0.03]} position={[0, height + 0.02, 0]} color="#ddd5c8" />
    </group>
  )
}

export function Dresser() {
  const { width, depth, height } = F.dresser
  const leg = 0.1
  const body = height - leg - 0.03
  const drawers = 3
  return (
    <group>
      <Legs width={width} depth={depth} height={leg} inset={0.05} size={0.04} />
      <Box size={[width, body, depth]} position={[0, leg + body / 2, 0]} color={WOOD.light} />
      <Box size={[width + 0.03, 0.03, depth + 0.02]} position={[0, height - 0.015, 0]} color={WOOD.mid} />
      {Array.from({ length: drawers }, (_, i) => {
        const y = leg + body * ((i + 0.5) / drawers)
        return (
          <group key={i}>
            {i > 0 && <Box size={[width - 0.05, 0.006, 0.006]} position={[0, leg + body * (i / drawers), depth / 2 + 0.003]} color={WOOD.dark} />}
            <Knob position={[-width / 4, y, depth / 2 + 0.015]} />
            <Knob position={[width / 4, y, depth / 2 + 0.015]} />
          </group>
        )
      })}
      {/* Vaso com flores secas */}
      <mesh position={[width / 2 - 0.2, height + 0.09, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 0.18, 18]} />
        <meshStandardMaterial color="#d7ccc8" roughness={0.4} />
      </mesh>
    </group>
  )
}

// ── Mesa e trabalho ────────────────────────────────────────────────────────

export function DiningTable() {
  const { width, depth, height } = F.diningTable
  const top = 0.05
  return (
    <group>
      <Legs width={width} depth={depth} height={height - top} inset={0.09} size={0.06} color={WOOD.mid} />
      <Box size={[width - 0.2, 0.08, depth - 0.2]} position={[0, height - top - 0.04, 0]} color={WOOD.mid} />
      <Soft size={[width, top, depth]} position={[0, height - top / 2, 0]} color={WOOD.mid} radius={0.015} />
      {/* Fruteira no centro */}
      <mesh position={[0, height + 0.04, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.1, 0.08, 24]} />
        <meshStandardMaterial color="#eceff1" roughness={0.35} />
      </mesh>
      {[[-0.05, 0.03, '#e67e22'], [0.06, -0.02, '#c0392b'], [0, -0.07, '#f1c40f']].map(([x, z, color]) => (
        <mesh key={color as string} position={[x as number, height + 0.1, z as number]} castShadow>
          <sphereGeometry args={[0.045, 14, 14]} />
          <meshStandardMaterial color={color as string} roughness={0.5} />
        </mesh>
      ))}
    </group>
  )
}

/** Cadeira de madeira com assento estofado; o encosto fica em -z. */
export function Chair() {
  const { width } = F.chair
  const seatY = 0.45
  const leg = 0.035
  const back = -0.2
  return (
    <group>
      <Legs width={width - 0.02} depth={0.44} height={seatY - 0.03} inset={0.03} size={leg} color={WOOD.mid} />
      <Box size={[width, 0.03, 0.44]} position={[0, seatY - 0.015, 0]} color={WOOD.mid} />
      <Soft size={[width - 0.04, 0.04, 0.4]} position={[0, seatY + 0.02, 0.01]} color="#c9b79c" radius={0.015} />
      {[-1, 1].map((side) => (
        <Box key={side} size={[leg, 0.48, leg]} position={[side * (width / 2 - 0.03), seatY + 0.24, back]} color={WOOD.mid} />
      ))}
      <Box size={[width - 0.02, 0.2, 0.025]} position={[0, seatY + 0.36, back]} color={WOOD.mid} />
      <Box size={[width - 0.06, 0.04, 0.02]} position={[0, seatY + 0.16, back]} color={WOOD.mid} />
    </group>
  )
}

export function Desk() {
  const { width, depth, height } = F.desk
  const top = 0.035
  return (
    <group>
      <Legs width={width} depth={depth} height={height - top} inset={0.04} size={0.035} color={METAL} />
      <Box size={[width, top, depth]} position={[0, height - top / 2, 0]} color="#d7c4a8" roughness={0.45} />
      {/* Gaveteiro sob o tampo, a direita */}
      <Box size={[0.4, 0.14, depth - 0.1]} position={[width / 2 - 0.26, height - top - 0.07, 0]} color="#cdb898" />
      <Knob position={[width / 2 - 0.26, height - top - 0.07, depth / 2 - 0.04]} />
      {/* Monitor, teclado e caneca */}
      <Box size={[0.24, 0.012, 0.16]} position={[0, height + 0.006, -depth / 2 + 0.16]} color={METAL} metalness={0.4} />
      <Box size={[0.035, 0.22, 0.03]} position={[0, height + 0.12, -depth / 2 + 0.14]} color={METAL} metalness={0.4} />
      <Box size={[0.64, 0.38, 0.025]} position={[0, height + 0.36, -depth / 2 + 0.16]} color="#111317" roughness={0.3} />
      <mesh position={[0, height + 0.36, -depth / 2 + 0.1735]}>
        <planeGeometry args={[0.6, 0.34]} />
        <meshStandardMaterial color="#14223a" emissive="#24406b" emissiveIntensity={0.5} roughness={0.2} />
      </mesh>
      <Box size={[0.44, 0.015, 0.14]} position={[0, height + 0.008, 0.08]} color="#e5e7ea" roughness={0.5} />
      <mesh position={[0.42, height + 0.05, 0.05]} castShadow>
        <cylinderGeometry args={[0.04, 0.036, 0.1, 18]} />
        <meshStandardMaterial color="#e74c3c" roughness={0.4} />
      </mesh>
    </group>
  )
}

/** Cadeira giratoria: base de cinco pes, pistao, assento, encosto e bracos. */
export function OfficeChair() {
  const seatY = 0.48
  return (
    <group>
      {Array.from({ length: 5 }, (_, i) => {
        const angle = (i / 5) * Math.PI * 2
        return (
          <group key={i} rotation={[0, angle, 0]}>
            <Box size={[0.3, 0.03, 0.04]} position={[0.15, 0.07, 0]} color={METAL} metalness={0.5} roughness={0.35} />
            <mesh position={[0.29, 0.03, 0]} castShadow>
              <sphereGeometry args={[0.03, 12, 12]} />
              <meshStandardMaterial color="#14161a" roughness={0.5} />
            </mesh>
          </group>
        )
      })}
      <mesh position={[0, 0.26, 0]} castShadow>
        <cylinderGeometry args={[0.025, 0.03, 0.36, 16]} />
        <meshStandardMaterial color="#9aa1aa" metalness={0.7} roughness={0.25} />
      </mesh>
      <Soft size={[0.5, 0.08, 0.48]} position={[0, seatY, 0.02]} color="#2f343c" radius={0.035} />
      <Box size={[0.06, 0.32, 0.03]} position={[0, seatY + 0.14, -0.23]} color={METAL} metalness={0.4} />
      <Soft size={[0.46, 0.5, 0.06]} position={[0, seatY + 0.42, -0.25]} rotation={[-0.08, 0, 0]} color="#2f343c" radius={0.04} />
      {[-1, 1].map((side) => (
        <group key={side}>
          <Box size={[0.03, 0.16, 0.03]} position={[side * 0.27, seatY + 0.1, 0.02]} color={METAL} metalness={0.4} />
          <Soft size={[0.06, 0.03, 0.26]} position={[side * 0.27, seatY + 0.19, 0.02]} color="#1f2328" radius={0.012} />
        </group>
      ))}
    </group>
  )
}
