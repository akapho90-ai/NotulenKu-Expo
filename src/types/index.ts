export type SegmentStatus = 'recording'|'saved'|'queued'|'processing'|'completed'|'failed'|'missing_file';
export type Segment = { id:number; sessionId:string; sequence:number; startedAt:string; endedAt?:string|null; uri?:string|null; status:SegmentStatus; durationMs?:number|null; attempts:number; error?:string|null; transcript?:string|null; transcriptOffsetMs?:number|null; startOffsetMs?:number|null };
export type TranscriptLine = { segmentId:number; offsetMs:number; speaker:string; text:string };
