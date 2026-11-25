const API_URL=process.env.EXPO_PUBLIC_NOTULENKU_API_URL||'';
export async function summarizeSession(sessionId:string){
 if(!API_URL)throw new Error('Set EXPO_PUBLIC_NOTULENKU_API_URL first.');
 const res=await fetch(`${API_URL}/summarize-session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_id:sessionId})});
 if(!res.ok)throw new Error(`Summary request failed (${res.status})`);
 return res.json();
}
