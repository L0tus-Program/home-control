import type { HomeApi } from './index'

declare global {
  interface Window {
    home: HomeApi
  }
}

export {}
