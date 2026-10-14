/**
 * Medidas da sala em metros. Paredes, moveis e aparelhos se posicionam a
 * partir daqui, entao tudo encosta onde deve sem numeros soltos.
 *
 * O piso e centrado na origem; as paredes ficam ao fundo (-z) e a esquerda
 * (-x). Frente e direita ficam abertas para a camera, como uma maquete.
 */
export const ROOM = {
  width: 8,
  depth: 7,
  wallHeight: 3.4,
  wallThickness: 0.12
} as const

/** Face interna de cada parede. */
export const BACK_WALL_Z = -ROOM.depth / 2
export const LEFT_WALL_X = -ROOM.width / 2

export type Vec3 = [number, number, number]

/** O modelo do AC e desenhado em unidades proprias; esta escala o leva a ~1,4 m. */
export const AC_SCALE = 0.6
/** Metade da profundidade do corpo do AC ja escalado: o quanto ele sai da parede. */
export const AC_HALF_DEPTH = 0.21 * AC_SCALE
const AC_HEIGHT = 2.65

/** Pontos de luz no piso, na ordem em que as lampadas sao distribuidas. */
export const LIGHT_SPOTS: Vec3[] = [
  [-2.95, 0, BACK_WALL_Z + 0.55], // ao lado esquerdo do sofa
  [0.55, 0, BACK_WALL_Z + 0.55], // ao lado direito do sofa
  [1.5, 0, BACK_WALL_Z + 2.8], // canto do tapete
  [-3.05, 0, BACK_WALL_Z + 2.8] // ponta da chaise
]

/** Onde cada AC fica preso: parede do fundo sobre o sofa, depois parede esquerda. */
export const AC_MOUNTS: { position: Vec3; rotationY: number }[] = [
  { position: [-1.2, AC_HEIGHT, BACK_WALL_Z + AC_HALF_DEPTH], rotationY: 0 },
  { position: [LEFT_WALL_X + AC_HALF_DEPTH, AC_HEIGHT, BACK_WALL_Z + 4.8], rotationY: Math.PI / 2 }
]

/** Para onde a camera olha: o centro da area de estar. */
export const CAMERA_TARGET: Vec3 = [0, 0.9, BACK_WALL_Z + 2.4]
