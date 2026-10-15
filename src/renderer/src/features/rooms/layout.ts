import { WALL_HEIGHT, wallsOf, type RoomDimensions, type Vec3 } from '../../../../shared/home'

export { AC_SCALE, wallsOf, type RoomDimensions, type Vec3 } from '../../../../shared/home'

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

/** Para onde a camera olha: o centro da area de estar. */
export function cameraTarget(dimensions: RoomDimensions): Vec3 {
  return [0, 0.9, wallsOf(dimensions).backZ + 2.4]
}
