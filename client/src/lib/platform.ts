// Detects the Capacitor Android shell. The web build and the native app share
// all code; only a few behaviours differ (no service worker, explicit server URL).
export function isNativeApp(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}
