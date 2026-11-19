import type { CapacitorConfig } from '@capacitor/cli';

// The Android app: this same React bundle, built with `vite build --mode android-*`
// (base '/', see vite.config.ts) and shipped inside the APK. Pages load from the
// device, and only API calls go over the network.
//
// appId is permanent once the app is on the Play Store - it IS the listing's
// identity. Changing it later means a brand-new app with zero installs.
const config: CapacitorConfig = {
  appId: 'in.sportagon.app',
  appName: 'Sportagon',
  webDir: 'dist',
  android: {
    // Serve the bundle at https://localhost (Capacitor's default). The API's CORS
    // allow-list must include that origin - see apps/api/src/http/server.ts.
    allowMixedContent: false,
    // Android 15+ draws every app edge-to-edge (and targetSdk 36 removes the
    // opt-out). Without this the header would sit under the status bar and the
    // bottom nav under the gesture bar.
    adjustMarginsForEdgeToEdge: 'force',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 3000,
      // initNative() hides it as soon as React has booted.
      launchAutoHide: true,
      backgroundColor: '#ffffff',
      showSpinner: false,
    },
  },
};

export default config;
