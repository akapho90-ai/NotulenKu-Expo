# Architecture (initial proposal)

Audio recording -> local session manifest -> segment queue -> upload -> STT provider -> transcript normalization -> incremental UI -> final summary.

Each segment record should include: session_id, segment_index, local_uri, start_ms, end_ms, status, retry_count, checksum, remote_uri, transcript, error_code.

Statuses: pending, recording, queued, uploading, transcribing, completed, retryable_error, permanent_error.

Keep provider secrets server-side. Use Edge Functions or a secured backend gateway. Do not expose service-role keys in the app.

Experimental records must be isolated from production data. Use a separate Supabase project if practical; otherwise distinct tables and policies, plus test accounts.
