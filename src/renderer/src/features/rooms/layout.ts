import { WALL_HEIGHT, type Room, type Vec3 } from '../../../../shared/home'

export { AC_SCALE, type Vec3 } from '../../../../shared/home'

/**
 * Medidas fixas da maquete em metros. Largura e profundidade vem do comodo
 * (`Room.dimensions`); moveis e aparelhos vem de `Room.items`.
 *
 * O piso e centrado na origem; as paredes ficam ao fundo (-z) e a esquerda
 * (-x). Frente e direita ficam abertas para a camera, como uma maquete.
 */
export const ROOM = {
  wallHeight: WALL_HEIGHT,
  wallThickness: 0.12
} as const

export type RoomDimensions = Room['dimensions']

/** Face interna de cada parede. */
export function wallsOf({ width, depth }: RoomDimensions): { backZ: number; leftX: number } {
  return { backZ: -depth / 2, leftX: -width / 2 }
}

/** Para onde a camera olha: o centro da area de estar. */
export function cameraTarget(dimensions: RoomDimensions): Vec3 {
  return [0, 0.9, wallsOf(dimensions).backZ + 2.4]
}
