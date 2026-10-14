import * as THREE from 'three'
import { useEffect, useMemo, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'

/**
 * Textura desenhada num canvas 2D. O three nao descarta texturas passadas via
 * `map=` junto com o material, entao a liberamos da GPU ao desmontar.
 */
export function useCanvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  repeat: [number, number] = [1, 1]
): THREE.CanvasTexture {
  const [repeatX, repeatY] = repeat
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    draw(canvas.getContext('2d')!, size)
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(repeatX, repeatY)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
    // `draw` e sempre uma funcao fixa do modulo; a textura so depende do tamanho.
  }, [size, repeatX, repeatY])

  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

/**
 * Hover com cursor de clique. Se o objeto sumir em hover (troca de tela,
 * aparelho removido) o onPointerOut nunca dispara, entao o cursor volta no unmount.
 */
export function useHoverCursor(): {
  hovered: boolean
  onPointerOver: (event: ThreeEvent<PointerEvent>) => void
  onPointerOut: () => void
} {
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (!hovered) return
    document.body.style.cursor = 'pointer'
    return () => { document.body.style.cursor = 'auto' }
  }, [hovered])

  return {
    hovered,
    onPointerOver: (event) => {
      event.stopPropagation()
      setHovered(true)
    },
    onPointerOut: () => setHovered(false)
  }
}
