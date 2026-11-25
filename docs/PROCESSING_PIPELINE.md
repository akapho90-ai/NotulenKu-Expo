# Processing pipeline implementation notes

## Client
- Segment status progression: saved -> processing -> completed or failed.
- Only segments with local URIs and saved/failed status are eligible.
- Failed segments can be reset and retried; successful segments remain completed.
- Transcript line offsets are segment-relative response offsets plus segment/session offset metadata (offset wiring is a prototype and needs test review).
- `transcriptStitch.ts` provides conservative word-boundary overlap dedup utility. It is not yet wired into final transcript rendering/export.

## Edge function
- STT function forwards audio segment to OpenAI transcription endpoint using server-side `OPENAI_API_KEY`, configurable `STT_MODEL`.
- Function normalizes `verbose_json` segment timings into `{text, lines}`.
- `speaker` currently defaults to a generic label; true diarization is not implemented.
- Deploy and protect with Supabase Auth/JWT, verify user/session/segment ownership, add rate limits and usage logging before production.

## Important
No provider call/build has been verified. This is code-level scaffolding only.
