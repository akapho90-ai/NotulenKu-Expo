# Build status v5

| Feature | Status |
|---|---|
| Light UI and logo | Prototype |
| Native MediaRecorder foreground service | Source drafted |
| Main UI native bridge | Integrated in source |
| Native 180s rotation | Source drafted |
| Segment metadata reconciled to SQLite | Source drafted |
| Build/APK | Not verified |
| Device/background/lock/call tests | Not performed |
| Crash recovery | Partial metadata groundwork only |
| STT provider integration | Scaffold |
| AI summary integration | Scaffold |

Next gate: Expo prebuild, native module registration and Android compile, then short recordings and segment rotation on a physical device.

## Stage 1 Android verification

The checked-in Android project is the build source for this branch. Keep microphone permissions and the recorder service declaration in both the checked-in manifest and the Expo config plugin used by prebuild. Expo Doctor's generic app-config sync warning is acknowledged in package.json. The Stage 1 tests check the checked-in recorder permissions, private microphone service, and Expo autolinking.

Run the app TypeScript check, the Node 22 SQLite regression tests, and Expo Doctor from the repository root. Edge Functions use the Deno runtime and sit outside the Expo TypeScript project. The Android CI job builds the debug APK and uploads it as a workflow artifact.

Before closing Stage 1, test start/stop and double taps, history navigation during a recording, locked-screen rotation, permission denial, calls and microphone contention, temporary disk exhaustion, force-stop and process recovery, reboot, and a recording spanning multiple rotations. Test with a physical microphone and verify that recovered files are playable. Exercise network retry with the secured endpoint separately.

Recordings stay in Android's app-private files directory under recordings/<session>. An Android/media destination requires an explicit export or a compatibility-tested storage migration that accounts for existing SQLite paths, uploads and interrupted sessions. Recovery preserves files that cannot currently be read.
