# Segment engine prototype

- Recording is rotated nominally every 180 seconds (3 min) by stopping and starting the expo-audio recorder.
- Segment metadata is persisted to SQLite, including start/end time, URI, status and duration.
- Rotation is a prototype and may introduce brief gaps; JS timers may be delayed when Android suspends the app.
- A background timer is NOT a guarantee of continuous rotation while app is backgrounded. Validate with development build/device; consider a native foreground-service recorder for robust long recording.
- Retry queue, audio upload, STT, transcript offsets, overlap dedup, checksum and crash recovery orchestration remain to be implemented.
- URI/path metadata checkpointing is implemented but app-kill recovery and media file survival need device tests.
