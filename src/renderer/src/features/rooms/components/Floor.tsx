import { useCanvasTexture } from '../hooks'
import { ROOM, wallsOf, type RoomDimensions } from '../layout'

const WINDOW = { x: 2.2, y: 1.95, width: 2.6, height: 1.9, bar: 0.07 }
const BASEBOARD = { height: 0.12, depth: 0.03 }

function drawWood(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = '#c9a87c'
  ctx.fillRect(0, 0, size, size)
  const rows = 24
  for (let i = 0; i < rows; i++) {
    const y = i * (size / rows)
    ctx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)'
    ctx.fillRect(0, y, size, size / rows)
    ctx.strokeStyle = 'rgba(60,40,20,0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(size, y)
    ctx.stroke()
  }
}

function drawPlaster(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.fillStyle = '#f4f1ea'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 6000; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.015)' : 'rgba(255,255,255,0.2)'
    ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2)
  }
}

/** Janela rente a parede do fundo: vidro claro, moldura e peitoril. Em salas estreitas, recua para caber. */
function Window({ backZ, roomWidth }: { backZ: number; roomWidth: number }) {
  const { width, height, bar } = WINDOW
  const frame = <meshStandardMaterial color="#ffffff" roughness={0.5} />
  return (
    <group position={[Math.min(WINDOW.x, roomWidth / 2 - width / 2 - 0.3), WINDOW.y, backZ]}>
      <mesh position={[0, 0, 0.01]}>
        <boxGeometry args={[width, height, 0.02]} />
        <meshStandardMaterial color="#bcd9f0" emissive="#6f97bd" emissiveIntensity={0.35} roughness={0.1} />
      </mesh>
      {/* Moldura: topo, base, laterais, montante e travessa */}
      {[height / 2, -height / 2, 0].map((y, i) => (
        <mesh key={`h${i}`} position={[0, y, 0.035]}>
          <boxGeometry args={[width + bar, bar, 0.07]} />
          {frame}
        </mesh>
      ))}
      {[-width / 2, width / 2, 0].map((x, i) => (
        <mesh key={`v${i}`} position={[x, 0, 0.035]}>
          <boxGeometry args={[bar, height + bar, 0.07]} />
          {frame}
        </mesh>
      ))}
      {/* Peitoril */}
      <mesh position={[0, -height / 2 - bar / 2 - 0.025, 0.07]} castShadow receiveShadow>
        <boxGeometry args={[width + 0.3, 0.05, 0.14]} />
        {frame}
      </mesh>
    </group>
  )
}

export function Floor({ dimensions }: { dimensions: RoomDimensions }) {
  const { width, depth } = dimensions
  const { wallHeight, wallThickness: t } = ROOM
  const { backZ, leftX } = wallsOf(dimensions)
  const woodTexture = useCanvasTexture(1024, drawWood, [width / 4.5, depth / 4.5])
  const backWallTexture = useCanvasTexture(512, drawPlaster, [width / 3, wallHeight / 3])
  const sideWallTexture = useCanvasTexture(512, drawPlaster, [depth / 3, wallHeight / 3])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial map={woodTexture} roughness={0.35} metalness={0.05} color="#e8dcc8" />
      </mesh>

      {/* Paredes: a face interna fica exatamente em backZ / leftX */}
      <mesh position={[-t / 2, wallHeight / 2, backZ - t / 2]} receiveShadow castShadow>
        <boxGeometry args={[width + t, wallHeight, t]} />
        <meshStandardMaterial map={backWallTexture} roughness={0.9} color="#f7f5f0" />
      </mesh>
      <mesh position={[leftX - t / 2, wallHeight / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[t, wallHeight, depth]} />
        <meshStandardMaterial map={sideWallTexture} roughness={0.9} color="#f7f5f0" />
      </mesh>

      {/* Rodapes */}
      <mesh position={[0, BASEBOARD.height / 2, backZ + BASEBOARD.depth / 2]}>
        <boxGeometry args={[width, BASEBOARD.height, BASEBOARD.depth]} />
        <meshStandardMaterial color="#8b7355" roughness={0.6} />
      </mesh>
      <mesh position={[leftX + BASEBOARD.depth / 2, BASEBOARD.height / 2, 0]}>
        <boxGeometry args={[BASEBOARD.depth, BASEBOARD.height, depth]} />
        <meshStandardMaterial color="#8b7355" roughness={0.6} />
      </mesh>

      <Window backZ={backZ} roomWidth={width} />
    </group>
  )
}
