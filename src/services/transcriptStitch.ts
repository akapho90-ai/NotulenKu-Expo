/**
 * Removes duplicated tail/head phrases when stitching segment transcripts with overlap.
 * Uses word-boundary matching; intentionally conservative (max 40 words).
 */
export function deduplicateOverlap(previous:string,next:string,maxWords=40):string{
 const a=previous.trim().split(/\s+/);const b=next.trim().split(/\s+/);
 const max=Math.min(maxWords,a.length,b.length);
 for(let n=max;n>=2;n--){
  const tail=a.slice(-n).join(' ').toLocaleLowerCase().replace(/[.,!?;:]+/g,'');
  const head=b.slice(0,n).join(' ').toLocaleLowerCase().replace(/[.,!?;:]+/g,'');
  if(tail===head)return `${previous.trim()} ${b.slice(n).join(' ')}`.trim();
 }
 return `${previous.trim()} ${next.trim()}`.trim();
}
export function mergeTranscriptSegments(segments:{sequence:number;text:string}[]){
 return segments.sort((a,b)=>a.sequence-b.sequence).reduce((acc,s)=>acc?deduplicateOverlap(acc,s.text):s.text,'');
}
