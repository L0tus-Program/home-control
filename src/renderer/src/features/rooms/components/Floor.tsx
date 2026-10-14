import * as THREE from 'three'
import { useMemo } from 'react'

export function Floor() {
  const woodTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 1024
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#c9a87c'
    ctx.fillRect(0, 0, 1024, 1024)
    for (let i = 0; i < 24; i++) {
      const y = i * (1024 / 24)
      ctx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)'
      ctx.fillRect(0, y, 1024, 1024 / 24)
      ctx.strokeStyle = 'rgba(60,40,20,0.08)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(1024, y)
      ctx.stroke()
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(4, 4)
    return tex
  }, [])

  const wallTexture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#f4f1ea'
    ctx.fillRect(0, 0, 512, 512)
    for (let i = 0; i < 6000; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.015)' : 'rgba(255,255,255,0.2)'
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(6, 3)
    return tex
  }, [])

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[18, 18]} />
        <meshStandardMaterial
          map={woodTexture}
          roughness={0.35}
          metalness={0.05}
          color="#e8dcc8"
        />
      </mesh>

      <group>
        <mesh position={[0, 4, -8.95]} receiveShadow castShadow>
          <boxGeometry args={[18, 8, 0.1]} />
          <meshStandardMaterial map={wallTexture} roughness={0.9} color="#f7f5f0" />
        </mesh>
        <mesh position={[-8.95, 4, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow castShadow>
          <boxGeometry args={[18, 8, 0.1]} />
          <meshStandardMaterial map={wallTexture} roughness={0.9} color="#f7f5f0" />
        </mesh>
      </group>

      <mesh position={[0, 0.15, -8.85]}>
        <boxGeometry args={[18, 0.3, 0.08]} />
        <meshStandardMaterial color="#8b7355" roughness={0.6} />
      </mesh>
      <mesh position={[-8.85, 0.15, 0]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[18, 0.3, 0.08]} />
        <meshStandardMaterial color="#8b7355" roughness={0.6} />
      </mesh>

      <group position={[3, 4.5, -8.85]}>
        <mesh>
          <boxGeometry args={[5.5, 4, 0.12]} />
          <meshPhysicalMaterial
            color="#dff6ff"
            transparent
            opacity={0.25}
            roughness={0.05}
            metalness={0.1}
            transmission={0.6}
            thickness={0.1}
          />
        </mesh>
        <mesh position={[0, 2.1, 0]}>
          <boxGeometry args={[5.7, 0.15, 0.18]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0, -2.1, 0]}>
          <boxGeometry args={[5.7, 0.15, 0.18]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[-2.8, 0, 0]}>
          <boxGeometry args={[0.15, 4.2, 0.18]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[2.8, 0, 0]}>
          <boxGeometry args={[0.15, 4.2, 0.18]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[0.08, 4.2, 0.18]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[5.7, 0.08, 0.18]} />
          <meshStandardMaterial color="#ffffff" />
        </mesh>
      </group>

      <directionalLight
        position={[3, 6, -12]}
        intensity={1.2}
        color="#fff8e7"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
    </group>
  )
}
