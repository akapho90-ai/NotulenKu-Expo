# v5 — Native engine integration draft

The app now calls the native foreground service instead of expo-audio for its primary recording button. Native segment metadata is periodically read through the bridge and reconciled into SQLite.

## Caveats / verification
- Source integration only; no Android compilation or physical-device test in this bundle.
- The service rotates MediaRecorder files on a Handler; transitions can create short gaps.
- Stop command delivery, Android foreground-service restrictions, permission prompt UX, module autolinking and generated Kotlin package placement must be verified in a development build.
- Recovery across process death is metadata-oriented, not guaranteed recorder continuation.
- The UI periodically reconciles files while active and upon stop.
- Ensure `npm install` and Expo prebuild generate module registration; if module registration fails, check Expo Modules autolinking and package config.
