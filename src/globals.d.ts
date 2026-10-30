// What Tourwright puts on `window` inside the recorded page (overlay.js, network.js).
export {}

declare global {
  interface Window {
    __tourwright?: { logo: string | null; focusOff?: (() => void) | null }
    __twSse?: boolean
    __twSseOpen?: (id: string, url: string) => void
    __twSseClose?: (id: string) => void
    __twSseEmit?: (id: string, type: string, data: string, lastEventId?: string) => void
  }
}
