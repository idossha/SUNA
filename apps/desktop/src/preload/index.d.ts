import type { SunaApi } from './index'

declare global {
  interface Window {
    suna: SunaApi
  }
}

export {}
