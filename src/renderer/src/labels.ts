/** Tradução dos modos de cada integração para português. */

const MODES: Record<string, string> = {
  white: 'Branco',
  colour: 'Cor',
  scene: 'Cena',
  music: 'Música',
  COOL: 'Refrigerar',
  AIR_DRY: 'Desumidificar',
  FAN: 'Ventilar',
  AUTO: 'Automatico',
  HEAT: 'Aquecer',
  AIR_CLEAN: 'Purificar',
  ENERGY_SAVING: 'Economia'
}

const FAN: Record<string, string> = {
  SLOW: 'Minima',
  SLOW_LOW: 'Muito baixa',
  LOW: 'Baixa',
  LOW_MID: 'Baixa+',
  MID: 'Media',
  MID_HIGH: 'Media+',
  HIGH: 'Alta',
  POWER: 'Turbo',
  AUTO: 'Auto',
  WIND: 'Vento',
  NATURE: 'Natural'
}

function humanize(value: string): string {
  const words = value.toLowerCase().split('_')
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

export const modeLabel = (value: string): string => MODES[value] ?? humanize(value)
export const fanLabel = (value: string): string => FAN[value] ?? humanize(value)

/** O gradiente do mostrador acompanha o que o aparelho esta fazendo. */
export function moodFor(mode: string | undefined, power: boolean): 'cool' | 'heat' | 'neutral' {
  if (!power) return 'neutral'
  switch (mode) {
    case 'HEAT':
      return 'heat'
    case 'COOL':
    case 'AIR_DRY':
      return 'cool'
    default:
      return 'neutral'
  }
}
