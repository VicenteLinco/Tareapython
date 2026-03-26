// frontend/src/lib/device-mode.ts

export type DeviceMode = 'normal' | 'kiosk' | 'qr'

const LS_KEY = 'lab-device-mode'
const SS_KEY = 'lab-device-mode-session'

const VALID_MODES = new Set<DeviceMode>(['kiosk', 'qr'])

export function getDeviceMode(): DeviceMode {
  const ls = localStorage.getItem(LS_KEY) as DeviceMode | null
  if (ls && VALID_MODES.has(ls)) return ls
  const ss = sessionStorage.getItem(SS_KEY) as DeviceMode | null
  if (ss && VALID_MODES.has(ss)) return ss
  return 'normal'
}

export function setDeviceMode(mode: DeviceMode, persistent: boolean): void {
  clearDeviceMode()
  if (mode === 'normal') return
  if (persistent) {
    localStorage.setItem(LS_KEY, mode)
  } else {
    sessionStorage.setItem(SS_KEY, mode)
  }
}

export function clearDeviceMode(): void {
  localStorage.removeItem(LS_KEY)
  sessionStorage.removeItem(SS_KEY)
}
