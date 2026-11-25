import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
serve(async (req)=>{
 if(req.method!=='POST') return new Response('Method not allowed',{status:405});
 const key=Deno.env.get('OPENAI_API_KEY');
 if(!key)return new Response(JSON.stringify({error:'OPENAI_API_KEY missing'}),{status:500,headers:{'content-type':'application/json'}});
 try{
  const incoming=await req.formData();const audio=incoming.get('audio');
  if(!(audio instanceof File))return new Response(JSON.stringify({error:'audio file required'}),{status:400,headers:{'content-type':'application/json'}});
  const providerForm=new FormData();providerForm.append('file',audio);providerForm.append('model',Deno.env.get('STT_MODEL')||'whisper-1');providerForm.append('response_format','verbose_json');providerForm.append('timestamp_granularities[]','segment');
  const stt=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:providerForm});
  if(!stt.ok)return new Response(JSON.stringify({error:`STT provider returned ${stt.status}`,details:await stt.text()}),{status:stt.status,headers:{'content-type':'application/json'}});
  const raw=await stt.json();const text=raw.text||'';const lines=(raw.segments||[]).map((seg:any)=>({speaker:'Speaker',text:seg.text||'',offsetMs:Math.round((seg.start||0)*1000)}));
  return new Response(JSON.stringify({text,offsetMs:0,lines}),{headers:{'content-type':'application/json'}});
 }catch(e){return new Response(JSON.stringify({error:e.message||String(e)}),{status:500,headers:{'content-type':'application/json'}})}
});
