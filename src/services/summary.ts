const API_URL = (process.env.EXPO_PUBLIC_NOTULENKU_API_URL || '').replace(/\/$/,'');

export async function summarizeSession(sessionId: string) {
 if (!API_URL) throw new Error('Set EXPO_PUBLIC_NOTULENKU_API_URL first.');
 const controller = new AbortController();
 const timeout = setTimeout(() => controller.abort(),90_000);
 try {
  const response = await fetch(`${API_URL}/summarize-session`,{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({session_id:sessionId}),
   signal:controller.signal,
  });
  if (!response.ok) throw new Error(`Summary request failed (${response.status})`);
  return await response.json();
 } catch (error) {
  if (controller.signal.aborted) throw new Error('Waktu permintaan ringkasan habis.');
  throw error;
 } finally {
  clearTimeout(timeout);
 }
}
