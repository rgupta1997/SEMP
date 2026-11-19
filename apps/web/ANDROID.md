# Sportagon Android app

The Android app is this same React app, wrapped with Capacitor 7 and shipped inside
the APK. Screens load from the phone, and only API calls go over the network. The
native project is in `android/`.

## One-time setup (per machine)

- JDK 21 and the Android SDK (platforms 35 and 36, build-tools 35). On Rohit's PC they
  live in `C:\Android\jdk21` and `C:\Android\Sdk`. The SDK path must have no spaces,
  because the SDK's `.bat` scripts break on them.
- `android/local.properties`: `sdk.dir=C\:/Android/Sdk` (git-ignored).
- `~/.gradle/gradle.properties`: `org.gradle.java.home=C:/Android/jdk21`. On a network
  with broken IPv6, also add `systemProp.java.net.preferIPv4Stack=true`.
- Or install Android Studio, which does all of this for you.

## Build

From `apps/web`:

| Command | What it does |
|---|---|
| `npm run android:sync:beta` | Build the web bundle against the BETA API and copy it into `android/` |
| `npm run android:sync:uat` | The same against UAT (events.sportagon.in). Use this for the Play Store |
| `npm run android:apk` | Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk` |
| `npm run android:release` | Signed `app-release.aab` (Play Store) and `app-release.apk` (direct install) |

Always run a `sync` first. The APK contains whatever bundle was last synced. The API
URLs are in `.env.android-beta` and `.env.android-uat`.

The API must allow the origin `https://localhost`. `apps/api/src/http/server.ts` does
this, so any API deployed from this branch onwards works with the app.

## Signing (release builds)

`android/keystore.properties` (git-ignored) points at the upload keystore in
`%USERPROFILE%\sportagon-android-keys\`. Without that file, release builds come out
unsigned. **Back up the `.jks` and `keystore.properties` somewhere safe.** If you lose
them, you cannot ship updates until Google support resets the key.

## Each new release

1. Bump `versionCode` (+1, always) and `versionName` in `android/app/build.gradle`.
2. `npm run android:sync:uat && npm run android:release`
3. Upload `app-release.aab` in Play Console.

## Icons and splash screen

`python tools/android-assets.py` regenerates them from
`public/assets/android-chrome-512x512.png`.

## Known gaps

- Document downloads and "open in a new tab" use blob URLs, which do nothing inside the
  app (certificate renders, exports). They need the Filesystem and Share plugins.
- No push notifications yet (needs Firebase and `@capacitor/push-notifications`).
