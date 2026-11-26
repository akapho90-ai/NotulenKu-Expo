import {File} from 'expo-file-system';
import {claimSegment, completeSegment, failSegment} from './db';
import type {Segment} from '../types';

const API_URL = (process.env.EXPO_PUBLIC_NOTULENKU_API_URL || '').replace(/\/$/,'');
type Line = {speaker: string; text: string; offsetMs: number};

function readTranscript(result: unknown, duration: number | null | undefined) {
 if (!result || typeof result !== 'object' || !('text' in result) || typeof result.text !== 'string') {
  throw new Error('Respons transkripsi tidak valid.');
 }
 const text = result.text.trim();
 const lines: Line[] = [];
 if ('lines' in result && result.lines !== undefined) {
  if (!Array.isArray(result.lines)) throw new Error('Baris transkripsi tidak valid.');
  for (const line of result.lines) {
   if (typeof line?.text !== 'string' || (line.offsetMs !== undefined &&
    (typeof line.offsetMs !== 'number' || !Number.isFinite(line.offsetMs) || line.offsetMs < 0))) {
    throw new Error('Baris transkripsi tidak valid.');
   }
   const offset = Math.round(line.offsetMs ?? 0);
   if (line.text.trim()) lines.push({
    speaker: typeof line.speaker === 'string' ? line.speaker.trim() || 'Speaker' : 'Speaker',
    text: line.text.trim(),
    offsetMs: duration && duration > 0 ? Math.min(offset,duration-1) : offset,
   });
  }
 }
 if (lines.length === 0 && text) lines.push({speaker:'Speaker',text,offsetMs:0});
 return {text,lines};
}

async function sendSegment(segment: Segment, uri: string, offset: number) {
 const form = new FormData();
 form.append('session_id',segment.sessionId);
 form.append('segment_id',String(segment.id));
 form.append('sequence',String(segment.sequence));
 form.append('offset_ms',String(offset));
 form.append('audio',{uri,name:`segment-${segment.sequence}.m4a`,type:'audio/mp4'} as unknown as Blob);

 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(),90_000);
 try {
  const response = await fetch(`${API_URL}/transcribe-segment`,{method:'POST',body:form,signal:controller.signal});
  if (!response.ok) throw new Error(`Transkripsi gagal (HTTP ${response.status}).`);
  return readTranscript(await response.json(),segment.durationMs);
 } catch (error) {
  if (controller.signal.aborted) throw new Error('Waktu permintaan transkripsi habis.');
  if (error instanceof SyntaxError) throw new Error('Respons transkripsi tidak valid.');
  throw error;
 } finally {
  clearTimeout(timeout);
 }
}

export async function transcribePending(sessionId: string, segments: Segment[], onProgress?: (done: number,total: number) => void) {
 if (!API_URL) throw new Error('Set EXPO_PUBLIC_NOTULENKU_API_URL.');
 const pending = segments.filter(segment => segment.sessionId === sessionId && segment.uri &&
  (segment.status === 'saved' || segment.status === 'failed')).sort((a,b) => a.sequence-b.sequence);
 let done = 0;
 for (const segment of pending) {
  if (claimSegment(sessionId,segment.id)) {
   try {
    const uri = segment.uri!.startsWith('/') ? `file://${segment.uri}` : segment.uri!;
    const file = new File(uri);
    if (!file.exists || file.size === 0) {
     failSegment(sessionId,segment.id,'File audio hilang, kosong, atau tidak dapat dibaca.',true);
    } else {
     const offset = segment.startOffsetMs ?? 0;
     const result = await sendSegment(segment,file.uri,offset);
     completeSegment(sessionId,segment.id,result.text,offset,result.lines);
    }
   } catch (error) {
    failSegment(sessionId,segment.id,error instanceof Error ? error.message : 'Transkripsi gagal.');
   }
  }
  onProgress?.(++done,pending.length);
 }
}
