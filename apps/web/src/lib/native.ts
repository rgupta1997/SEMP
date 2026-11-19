// The Android app (Capacitor) runs this same bundle from inside the APK, served
// at https://localhost. Two things follow from that and live here:
//
// 1. window.location.origin is `https://localhost` - fine for in-app routing,
//    useless in a link handed to someone else. Every URL meant to leave the
//    device (share links, certificate verify links, sign-in instructions) goes
//    through publicUrl(), which uses the public website in the app and the
//    current origin on the web (unchanged behaviour there).
// 2. The hardware back button, status bar and splash screen need native wiring
//    the browser never needed. initNative() does that once at boot, and is a
//    no-op on the web.
import { Capacitor } from '@capacitor/core';

export const isNativeApp = Capacitor.isNativePlatform();

/** The origin links are shared under. On the web, wherever the app was loaded
 *  from; in the app, the public website baked in at build time. */
export function publicOrigin(): string {
  if (isNativeApp && import.meta.env.VITE_PUBLIC_WEB_URL) return import.meta.env.VITE_PUBLIC_WEB_URL.replace(/\/$/, '');
  return window.location.origin;
}

/** An absolute, shareable URL for a site path such as `/verify/abc`. */
export const publicUrl = (path: string): string => `${publicOrigin()}${path.startsWith('/') ? path : `/${path}`}`;

/** Open a public page: in a new tab on the web, in the system browser in the app. */
export function openPublic(path: string): void {
  window.open(isNativeApp ? publicUrl(path) : path, '_blank', 'noopener');
}

export async function initNative(): Promise<void> {
  if (!isNativeApp) return;
  // Loaded lazily so the web bundle never pulls the plugin code into its entry chunk.
  const [{ App }, { StatusBar, Style }, { SplashScreen }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
  ]);

  // Back button: step back through the app's own history; at the first screen, leave.
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else App.exitApp();
  });

  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
    const dark = document.documentElement.classList.contains('dark');
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: dark ? '#0f172a' : '#ffffff' });
  } catch { /* status bar is cosmetic */ }

  await SplashScreen.hide();
}
