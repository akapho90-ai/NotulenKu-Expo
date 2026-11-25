# Native Recording Engine v4

This iteration introduces an Android foreground-service-owned MediaRecorder and Expo native-module bridge. Native service rotates M4A AAC files on a Handler cadence (default 180s), writes files under app-private filesDir/recordings/<session>/, and stores basic service state/segment manifest in SharedPreferences. JS bridge exposes start/stop/getState.

## Known limitations / not verified
- This service has not been compiled or device-tested in this workspace.
- JS app UI has not yet been switched from expo-audio recording to this bridge; avoid using both recorders simultaneously.
- The service is not yet robustly recovered after process death: manifest updates currently happen at stop, not each rollover.
- Segments are rotated by stopping/restarting MediaRecorder and may have gaps.
- Notification has no user action controls. Calls, OEM battery restrictions, permission edge cases and Android 14+ behavior require device tests.
- API/Expo module registration may require adjusting generated Android project after prebuild.

## Bridge usage (in JS)
Import `nativeRecorder` from `src/services/nativeRecorder`; start(sessionId, 180); stop(); getState().
