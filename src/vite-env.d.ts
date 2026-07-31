/// <reference types="vite/client" />

import type { NovaApi } from '../electron/shared/types'

declare global {
  interface Window {
    nova: NovaApi
  }
}

export {}
