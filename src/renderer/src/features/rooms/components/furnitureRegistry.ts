import type { FurnitureAssetId } from '../../../../../shared/home'
import { Bookshelf, CoffeeTable, Plant, Rug, Sofa } from './Furniture'
import {
  Armchair, BedDouble, BedSingle, Chair, Desk, DiningTable, Dresser, Nightstand, OfficeChair, StraightSofa, TvStand, Wardrobe
} from './ExtraFurniture'

/** Moveis do catalogo, desenhados na origem; o RoomItem da posicao e giro. */
export const FURNITURE: Record<FurnitureAssetId, () => React.JSX.Element> = {
  'sofa-l': Sofa,
  sofa: StraightSofa,
  armchair: Armchair,
  'coffee-table': CoffeeTable,
  'tv-stand': TvStand,
  bookshelf: Bookshelf,
  plant: Plant,
  rug: Rug,
  'bed-double': BedDouble,
  'bed-single': BedSingle,
  nightstand: Nightstand,
  wardrobe: Wardrobe,
  dresser: Dresser,
  'dining-table': DiningTable,
  chair: Chair,
  desk: Desk,
  'office-chair': OfficeChair
}
