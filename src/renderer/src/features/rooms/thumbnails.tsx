import * as THREE from 'three'
import { useRef, useSyncExternalStore } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { FURNITURE_ASSETS, type FurnitureAssetId } from '../../../../shared/home'
import { FURNITURE } from './components/furnitureRegistry'

/**
 * Miniaturas da paleta, fotografadas dos proprios modelos 3D: o que aparece
 * no menu e exatamente o que entra na maquete. Cada movel e fotografado uma
 * vez por sessao e a imagem fica em memoria.
 */

let thumbnails: ReadonlyMap<FurnitureAssetId, string> = new Map()
const listeners = new Set<() => void>()

function store(assetId: FurnitureAssetId, url: string): void {
  thumbnails = new Map(thumbnails).set(assetId, url)
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useFurnitureThumbnails(): ReadonlyMap<FurnitureAssetId, string> {
  return useSyncExternalStore(subscribe, () => thumbnails)
}

const VIEW = new THREE.Vector3(1, 0.8, 1.25).normalize()

/** Enquadra o objeto inteiro, visto do mesmo angulo da maquete. */
function frame(camera: THREE.PerspectiveCamera, object: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(object)
  const center = box.getCenter(new THREE.Vector3())
  const radius = box.getSize(new THREE.Vector3()).length() / 2
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))
  camera.position.copy(center).addScaledVector(VIEW, distance)
  camera.near = distance / 50
  camera.far = distance * 4
  camera.lookAt(center)
  camera.updateProjectionMatrix()
}

/** Um movel diante da camera: enquadra, espera a cena assentar e fotografa. */
function Shot({ assetId }: { assetId: FurnitureAssetId }) {
  const group = useRef<THREE.Group>(null)
  const frames = useRef(0)
  const { gl, scene, camera } = useThree()
  const Model = FURNITURE[assetId]

  // Prioridade 1: este quadro desenha a cena por conta propria.
  useFrame(() => {
    if (!group.current) return
    frames.current += 1
    if (frames.current === 2) frame(camera as THREE.PerspectiveCamera, group.current)
    gl.render(scene, camera)
    if (frames.current === 4) store(assetId, gl.domElement.toDataURL('image/png'))
  }, 1)

  return <group ref={group}><Model /></group>
}

/**
 * Estudio fora da tela que fotografa os moveis que ainda nao tem miniatura
 * e some quando termina, liberando o contexto WebGL.
 */
export function ThumbnailStudio(): React.JSX.Element | null {
  const done = useFurnitureThumbnails()
  const next = FURNITURE_ASSETS.find((assetId) => !done.has(assetId))
  if (!next) return null
  return (
    <div className="room-thumb-studio" aria-hidden="true">
      <Canvas dpr={2} camera={{ fov: 30 }} gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}>
        <ambientLight intensity={0.55} />
        <hemisphereLight args={['#dfeeff', '#3b2f24', 0.6]} />
        <directionalLight position={[3, 6, 4]} intensity={1.6} color="#fff4e0" />
        <directionalLight position={[-4, 2, -2]} intensity={0.35} color="#9fc3ff" />
        <Shot key={next} assetId={next} />
      </Canvas>
    </div>
  )
}
