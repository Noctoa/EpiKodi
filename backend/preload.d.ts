import type { EpiKodiApi } from '../shared/ipc'

declare global {
  interface Window {
    epikodi: EpiKodiApi
  }
}
