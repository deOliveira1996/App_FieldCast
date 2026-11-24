---
name: fieldcast-android-release
description: Synchronize the worktree to F:\Backup-data\local_data\App_FieldCast, generate Capacitor Android launcher mipmap icons, run npx cap sync android, verify Android 14+ manifest permissions, and compile app-debug.apk + dist/. Use for Windows and Android release builds.
---

# FieldCast Windows & Android Release

1. Sync source tree cleanly to `F:\Backup-data\local_data\App_FieldCast` (without leaving untracked build junk).
2. Run `scripts/sync-and-verify.ps1` (or `compilar-fieldcast.bat`) in `F:\Backup-data\local_data\App_FieldCast`:
   - `npm run icons:generate` (writes both PWA PNGs and Android `mipmap-*/ic_launcher*.png` + adaptive `#0f172a` background)
   - `npx tsc --noEmit`
   - `npm run test`
   - `npm run build` (`dist/` for Windows/PWA)
3. Run `npx cap sync android`, confirm `AndroidManifest.xml` preserves `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `WAKE_LOCK`, and `INTERNET`.
4. Run `.\gradlew.bat assembleDebug --no-daemon` inside `android/` and confirm `android\app\build\outputs\apk\debug\app-debug.apk`.
