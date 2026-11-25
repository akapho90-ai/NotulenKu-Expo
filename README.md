# NotulenKu Expo Lab — v5 native recording integration draft

This iteration wires the Android native MediaRecorder foreground service to the main recording control and SQLite segment reconciliation.

## Setup
1. Extract and run `npm install`.
2. Run `npx expo install --fix` to align Expo dependencies.
3. Run `npx expo prebuild` and inspect generated Android project.
4. Build a development APK with Android Studio or `npx expo run:android`. A physical Android device is required for microphone/background tests.

## v5 integration
- Main UI calls the native recorder bridge (not expo-audio capture).
- Native foreground service records M4A/AAC and rotates nominally every 180 seconds.
- Bridge returns session state and segment metadata; UI reconciles completed files to SQLite.
- Permissions and microphone foreground service declaration are added by config plugin.

## Important
This is source-level integration only; no compile, install or device verification was performed. Segment transitions can have gaps. Foreground service and module autolinking must be verified. Current segment is only finalized on rotation or stop. Crash recovery and call interruption handling are not guaranteed. STT/summary APIs remain separate scaffolds.

## STT
Configure `EXPO_PUBLIC_NOTULENKU_API_URL` for the transcription Edge Function only after securing and deploying it. Do not place provider secrets in client env vars.
