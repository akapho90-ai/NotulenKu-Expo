// Summary endpoint scaffold. Use auth/RLS and a server-side AI provider key.
import {serve} from 'https://deno.land/std@0.224.0/http/server.ts';
serve(async(req)=>{
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 if(!Deno.env.get('AI_API_KEY'))return new Response(JSON.stringify({error:'AI_API_KEY missing'}),{status:500,headers:{'content-type':'application/json'}});
 return new Response(JSON.stringify({error:'Summary provider adapter not configured'}),{status:501,headers:{'content-type':'application/json'}});
});
