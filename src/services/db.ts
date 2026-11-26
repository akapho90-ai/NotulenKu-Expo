import * as SQLite from 'expo-sqlite';
import type {Segment} from '../types';
export const db=SQLite.openDatabaseSync('notulenku_expo.db');
export function initializeDb(){
 db.execSync(`PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, title TEXT, started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS segments(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, sequence INTEGER NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, uri TEXT, status TEXT NOT NULL, duration_ms INTEGER, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, transcript TEXT, transcript_offset_ms INTEGER, start_offset_ms INTEGER NOT NULL DEFAULT 0, UNIQUE(session_id,sequence));
 CREATE TABLE IF NOT EXISTS transcript_lines(id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, segment_id INTEGER NOT NULL, offset_ms INTEGER NOT NULL, speaker TEXT NOT NULL, text TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_segments_session ON segments(session_id,sequence);
 CREATE INDEX IF NOT EXISTS idx_lines_session ON transcript_lines(session_id,offset_ms);`);
 try { db.execSync('ALTER TABLE segments ADD COLUMN start_offset_ms INTEGER NOT NULL DEFAULT 0'); } catch {}
}
export function createSession(id:string,title:string){
 db.runSync('INSERT INTO sessions(id,title,started_at,status,created_at) VALUES(?,?,?,?,?)',id,title,new Date().toISOString(),'recording',new Date().toISOString());
}
export function insertSegment(sessionId:string,sequence:number){
 const start=new Date().toISOString();const r=db.runSync('INSERT INTO segments(session_id,sequence,started_at,status) VALUES(?,?,?,?)',sessionId,sequence,start,'recording');return Number(r.lastInsertRowId);
}
export function finishSegment(id:number,uri:string|null,durationMs:number){
 db.runSync('UPDATE segments SET ended_at=?,uri=?,status=?,duration_ms=? WHERE id=?',new Date().toISOString(),uri,uri?'saved':'missing_file',durationMs,id);
}
export function listSegments(sessionId:string):Segment[]{
 return db.getAllSync<any>('SELECT id,session_id as sessionId,sequence,started_at as startedAt,ended_at as endedAt,uri,status,duration_ms as durationMs,attempts,error,transcript,transcript_offset_ms as transcriptOffsetMs,start_offset_ms as startOffsetMs FROM segments WHERE session_id=? ORDER BY sequence',sessionId);
}
export function listSessions(){
 return db.getAllSync<any>('SELECT id,title,started_at as startedAt,ended_at as endedAt,status FROM sessions ORDER BY created_at DESC');
}
export function markSegment(id:number,status:string,error?:string){
 db.runSync('UPDATE segments SET status=?,error=?,attempts=attempts+1 WHERE id=?',status,error||null,id);
}
export function setSegmentTranscript(id:number,transcript:string,offsetMs:number){
 db.runSync('UPDATE segments SET transcript=?,transcript_offset_ms=?,status=?,error=NULL WHERE id=?',transcript,offsetMs,'completed',id);
}
export function addTranscriptLines(sessionId:string,segmentId:number,offsetMs:number,lines:{speaker:string;text:string;offsetMs?:number}[]){
 db.execSync('BEGIN');
 try{
  db.runSync('DELETE FROM transcript_lines WHERE segment_id=?',segmentId);
  for(const l of lines) db.runSync('INSERT INTO transcript_lines(session_id,segment_id,offset_ms,speaker,text) VALUES(?,?,?,?,?)',sessionId,segmentId,offsetMs+(l.offsetMs||0),l.speaker,l.text);
  db.execSync('COMMIT');
 }catch(e){db.execSync('ROLLBACK');throw e;}
}
export function getTranscript(sessionId:string){
 return db.getAllSync<any>('SELECT offset_ms as offsetMs,speaker,text FROM transcript_lines WHERE session_id=? ORDER BY offset_ms',sessionId);
}
export function setSegmentStartOffset(id:number,offsetMs:number){
 db.runSync('UPDATE segments SET start_offset_ms=? WHERE id=?',offsetMs,id);
}
export function setSessionStatus(id:string,status:string){
 const endedAt=status==='recording'?null:new Date().toISOString();
 db.runSync('UPDATE sessions SET ended_at=?,status=? WHERE id=?',endedAt,status,id);
}
export function getTranscriptLinesRaw(sessionId:string){
 return db.getAllSync<any>('SELECT offset_ms as offsetMs,speaker,text FROM transcript_lines WHERE session_id=? ORDER BY offset_ms',sessionId);
}

/**
 * Reconcile native recorder metadata with SQLite by session + sequence.
 * If an existing placeholder row lacks its audio URI, enrich it instead of skipping it.
 */
export function syncNativeSegments(sessionId:string,nativeSegments:any[],segmentSeconds:number){
 db.execSync('BEGIN');
 try{
  for(const n of nativeSegments||[]){
   const seq=Number(n.index);
   if(!Number.isFinite(seq)||seq<0)continue;
   const startedMs=Number(n.startedAtMs)||Date.now();
   const endedMs=Number(n.endedAtMs)||startedMs;
   const started=new Date(startedMs).toISOString();
   const ended=new Date(endedMs).toISOString();
   const duration=Math.max(0,endedMs-startedMs);
   const uri=typeof n.path==='string'&&n.path.length?n.path:null;
   const offset=Number(n.offsetMs)||seq*segmentSeconds*1000;
   const exists=db.getFirstSync<any>('SELECT id,uri,status FROM segments WHERE session_id=? AND sequence=?',[sessionId,seq]);
   if(!exists){
    db.runSync('INSERT INTO segments(session_id,sequence,started_at,ended_at,uri,status,duration_ms,start_offset_ms) VALUES(?,?,?,?,?,?,?,?)',sessionId,seq,started,ended,uri,uri?'saved':'missing_file',duration,offset);
   }else if(uri&&(!exists.uri||exists.status==='recording'||exists.status==='missing_file')){
    db.runSync('UPDATE segments SET started_at=?,ended_at=?,uri=?,status=?,duration_ms=?,start_offset_ms=?,error=NULL WHERE id=?',started,ended,uri,'saved',duration,offset,exists.id);
   }
  }
  db.execSync('COMMIT');
 }catch(e){db.execSync('ROLLBACK');throw e;}
}

export function ensureRecoveredSession(id:string,startedAtMs:number){
 const started=new Date(startedAtMs>0?startedAtMs:Date.now()).toISOString();
 const exists=db.getFirstSync<any>('SELECT id,status FROM sessions WHERE id=?',[id]);
 if(exists){
  if(exists.status!=='recording')db.runSync('UPDATE sessions SET status=?,ended_at=NULL WHERE id=?','recording',id);
  return;
 }
 db.runSync('INSERT OR IGNORE INTO sessions(id,title,started_at,status,created_at) VALUES(?,?,?,?,?)',id,'Recovered recording',started,'recording',new Date().toISOString());
}
