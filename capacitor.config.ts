import type { CapacitorConfig } from '@capacitor/cli';

// The Android app bundles the built PWA (dist/client). It talks to the
// deployed PRECEPTOR backend set at build time via VITE_API_BASE_URL (or in
// Settings → Server). The Gemini key stays on that backend — never in the APK.
const config: CapacitorConfig = {
  appId: 'org.preceptor.clinicalpharmacy',
  appName: 'PRECEPTOR',
  webDir: 'dist/client',
  android: {
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
