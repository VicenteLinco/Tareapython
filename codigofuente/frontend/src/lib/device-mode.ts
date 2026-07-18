// frontend/src/lib/device-mode.ts

export type DeviceMode = "normal";

const LS_KEY = "lab-device-mode";
const SS_KEY = "lab-device-mode-session";

export function getDeviceMode(): DeviceMode {
  return "normal";
}

export function setDeviceMode(mode: DeviceMode, persistent: boolean): void {
  void mode;
  void persistent;
  clearDeviceMode();
}

export function clearDeviceMode(): void {
  localStorage.removeItem(LS_KEY);
  sessionStorage.removeItem(SS_KEY);
}
