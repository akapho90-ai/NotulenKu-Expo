import {markSegment,setSegmentTranscript,addTranscriptLines,db} from './db';
import type {Segment} from '../types';
const API_URL=(process.env.EXPO_PUBLIC_NOTULENKU_API_URL||'').replace(/\/$/,'');
async function sendSegment(segment:Segment,sessionId:string){
 if(!API_URL) throw new Error('Set EXPO_PUBLIC_NOTULENKU_API_URL.');
 if(!segment.uri) throw new Error('Segment audio URI missing.');
 const form=new FormData();
 form.append('session_id',sessionId);form.append('segment_id',String(segment.id));form.append('sequence',String(segment.sequence||0));form.append('offset_ms',String(segment.transcriptOffsetMs||0));
 form.append('audio',{uri:segment.uri,name:`segment-${segment.sequence||segment.id}.m4a`,type:'audio/mp4'} as any);
 const res=await fetch(`${API_URL}/transcribe-segment`,{method:'POST',body:form});
 if(!res.ok)throw new Error(`STT HTTP ${res.status}: ${await res.text()}`);
 return await res.json() as {text:string;lines?:{speaker:string;text:string;offsetMs?:number}[];offsetMs?:number};
}
export async function transcribePending(sessionId:string,segments:Segment[],onProgress?:(done:number,total:number)=>void){
 const pending=segments.filter(s=>['saved','failed'].includes(s.status)&&s.uri);
 let done=0;
 for(const s of pending){
  markSegment(s.id,'processing');
  try{
   const result=await sendSegment(s,sessionId);
   const offset=result.offsetMs??s.transcriptOffsetMs??0;
   setSegmentTranscript(s.id,result.text,offset);
   const lines=result.lines?.length?result.lines:[{speaker:'Speaker',text:result.text,offsetMs:0}];
   addTranscriptLines(sessionId,s.id,offset,lines);
  }catch(e:any){markSegment(s.id,'failed',e?.message||String(e));}
  done++;onProgress?.(done,pending.length);
 }
}
export function retryFailed(sessionId:string){
 // Explicitly reset failed rows, preserving attempts and error history in current schema's attempts counter.
 db.runSync("UPDATE segments SET status='saved',error=NULL WHERE session_id=? AND status='failed' AND uri IS NOT NULL",sessionId);
}
function markRetry(sessionId:string){
 const {db}=requireDb();
 db.runSync("UPDATE segments SET status='saved',error=NULL WHERE session_id=? AND status='failed' AND uri IS NOT NULL",sessionId);
}
function requireDb(){return {db: (global as any).__notulenku_db};}
