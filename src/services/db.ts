import * as SQLite from 'expo-sqlite';
import type {Segment} from '../types';
import type {NativeSegment, RecorderState} from './nativeRecorder';

export const db = SQLite.openDatabaseSync('notulenku_expo.db');
type SessionRow = {id: string; title: string; startedAt: string; endedAt: string | null; status: string};
type StoredLine = {speaker: string; text: string; offsetMs: number};

export function initializeDb() {
 db.execSync('PRAGMA journal_mode=WAL');
 db.withTransactionSync(() => {
  db.execSync(`CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, title TEXT, started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS segments(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, sequence INTEGER NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, uri TEXT, status TEXT NOT NULL, duration_ms INTEGER, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, transcript TEXT, transcript_offset_ms INTEGER, start_offset_ms INTEGER NOT NULL DEFAULT 0, UNIQUE(session_id,sequence));
  CREATE TABLE IF NOT EXISTS transcript_lines(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, segment_id INTEGER NOT NULL, offset_ms INTEGER NOT NULL, speaker TEXT NOT NULL, text TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_segments_session ON segments(session_id,sequence);
  CREATE INDEX IF NOT EXISTS idx_lines_session ON transcript_lines(session_id,offset_ms);
  CREATE INDEX IF NOT EXISTS idx_lines_segment ON transcript_lines(segment_id);`);
  const columns = db.getAllSync<{name: string}>('PRAGMA table_info(segments)');
  if (!columns.some(column => column.name === 'start_offset_ms')) {
   db.execSync('ALTER TABLE segments ADD COLUMN start_offset_ms INTEGER NOT NULL DEFAULT 0');
  }
  db.execSync(`UPDATE segments SET status='failed',error='Pemrosesan sebelumnya terputus. Silakan coba lagi.'
    WHERE status='processing';
   INSERT INTO transcript_lines(session_id,segment_id,offset_ms,speaker,text)
   SELECT s.session_id,s.id,COALESCE(s.transcript_offset_ms,s.start_offset_ms),'Speaker',s.transcript
   FROM segments s
   WHERE s.status='completed' AND length(trim(s.transcript))>0
    AND NOT EXISTS(SELECT 1 FROM transcript_lines l WHERE l.segment_id=s.id);`);
 });
}

export function listSegments(sessionId: string) {
 return db.getAllSync<Segment>(`SELECT id,session_id as sessionId,sequence,started_at as startedAt,ended_at as endedAt,uri,
 status,duration_ms as durationMs,attempts,error,transcript,transcript_offset_ms as transcriptOffsetMs,
 start_offset_ms as startOffsetMs FROM segments WHERE session_id=? ORDER BY sequence`,sessionId);
}

export function listSessions() {
 return db.getAllSync<SessionRow>('SELECT id,title,started_at as startedAt,ended_at as endedAt,status FROM sessions ORDER BY created_at DESC');
}

export function getTranscript(sessionId: string) {
 return db.getAllSync<StoredLine>(`SELECT l.offset_ms as offsetMs,l.speaker,l.text
  FROM transcript_lines l JOIN segments s ON s.id=l.segment_id AND s.session_id=l.session_id
  WHERE l.session_id=? ORDER BY l.offset_ms,s.sequence,l.id`,sessionId);
}

export function claimSegment(sessionId: string, id: number) {
 return db.runSync(`UPDATE segments SET status='processing',error=NULL,attempts=attempts+1
  WHERE id=? AND session_id=? AND status IN ('saved','failed') AND uri IS NOT NULL`,id,sessionId).changes === 1;
}

export function failSegment(sessionId: string, id: number, error: string, missing = false) {
 db.runSync(`UPDATE segments SET status=?,error=? WHERE id=? AND session_id=? AND status='processing'`,
  missing ? 'missing_file' : 'failed',error,id,sessionId);
}

export function completeSegment(sessionId: string, id: number, transcript: string, offset: number, lines: StoredLine[]) {
 db.withTransactionSync(() => {
  const updated = db.runSync(`UPDATE segments SET transcript=?,transcript_offset_ms=?,status='completed',error=NULL
   WHERE id=? AND session_id=? AND status='processing'`,transcript,offset,id,sessionId);
  if (updated.changes !== 1) return;
  db.runSync('DELETE FROM transcript_lines WHERE segment_id=? AND session_id=?',id,sessionId);
  for (const line of lines) {
   db.runSync('INSERT INTO transcript_lines(session_id,segment_id,offset_ms,speaker,text) VALUES(?,?,?,?,?)',
    sessionId,id,offset+line.offsetMs,line.speaker,line.text);
  }
 });
}

export function syncRecording(state: RecorderState, recovered = false) {
 if (state.status === 'starting') return;
 const segments = JSON.parse(state.segments) as NativeSegment[];
 const startedAt = new Date(state.startedAt).toISOString();
 const end = segments.reduce((latest, segment) => Math.max(latest, segment.endedAtMs),state.startedAt);
 const endedAt = state.active ? null : new Date(end).toISOString();
 db.withTransactionSync(() => {
  db.runSync(`INSERT INTO sessions(id,title,started_at,ended_at,status,created_at) VALUES(?,?,?,?,?,?)
   ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at,ended_at=excluded.ended_at,status=excluded.status`,
   state.sessionId,recovered ? 'Recovered recording' : 'Rapat baru',startedAt,endedAt,state.status,startedAt);
  for (const segment of segments) {
   const sequence = segment.index;
   if (!Number.isSafeInteger(sequence) || sequence < 0) continue;
   const start = new Date(segment.startedAtMs).toISOString();
   const finish = new Date(segment.endedAtMs).toISOString();
   const duration = Math.max(0,segment.endedAtMs-segment.startedAtMs);
   const offset = segment.offsetMs ?? sequence*state.segmentSeconds*1000;
   const current = db.getFirstSync<{id: number; status: string; transcriptOffsetMs: number | null}>(
    'SELECT id,status,transcript_offset_ms as transcriptOffsetMs FROM segments WHERE session_id=? AND sequence=?',state.sessionId,sequence);
   const status = segment.path ? 'saved' : 'missing_file';
   if (!current) {
    db.runSync(`INSERT INTO segments(session_id,sequence,started_at,ended_at,uri,status,duration_ms,start_offset_ms)
     VALUES(?,?,?,?,?,?,?,?)`,state.sessionId,sequence,start,finish,segment.path ?? null,status,duration,offset);
   } else if (current.status !== 'processing') {
    const nextStatus = current.status === 'completed' || (current.status === 'failed' && segment.path) ? current.status : status;
    db.runSync(`UPDATE segments SET started_at=?,ended_at=?,uri=?,status=?,duration_ms=?,start_offset_ms=?,
      error=CASE WHEN ?='saved' THEN NULL ELSE error END WHERE id=?`,
     start,finish,segment.path ?? null,nextStatus,duration,offset,nextStatus,current.id);
    if (current.status === 'completed' && current.transcriptOffsetMs !== offset) {
     db.runSync('UPDATE transcript_lines SET offset_ms=MAX(0,offset_ms+?) WHERE segment_id=? AND session_id=?',
      offset-(current.transcriptOffsetMs ?? 0),current.id,state.sessionId);
     db.runSync('UPDATE segments SET transcript_offset_ms=? WHERE id=?',offset,current.id);
    }
   }
  }
 });
}

export function reconcileInactiveSessions(activeId: string | null) {
 db.runSync(`UPDATE sessions SET status='interrupted',
  ended_at=COALESCE((SELECT MAX(ended_at) FROM segments WHERE session_id=sessions.id),started_at)
  WHERE status='recording' AND id IS NOT ?`,activeId);
}
