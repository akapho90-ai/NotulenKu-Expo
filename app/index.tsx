import React,{useEffect,useState,useRef} from 'react';
import {SafeAreaView,View,Text,Image,ScrollView,Pressable,StyleSheet,Alert,ActivityIndicator} from 'react-native';
import {AudioModule} from 'expo-audio';
import {nativeRecorder,type RecorderState} from '../src/services/nativeRecorder';
import {initializeDb,listSegments,listSessions,getTranscript,syncRecording,reconcileInactiveSessions} from '../src/services/db';
import {transcribePending} from '../src/services/transcription';
import {summarizeSession} from '../src/services/summary';

const fmt=(ms:number)=>{const s=Math.floor(ms/1000);return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`};
const message = (error: unknown) => error instanceof Error ? error.message : '';

export default function Home() {
 const [recording,setRecording] = useState<RecorderState | null>(null);
 const [selected,setSelected] = useState<string | null>(null);
 const [segments,setSegments] = useState<ReturnType<typeof listSegments>>([]);
 const [sessions,setSessions] = useState<ReturnType<typeof listSessions>>([]);
 const [lines,setLines] = useState<ReturnType<typeof getTranscript>>([]);
 const [ready,setReady] = useState(false);
 const [recorderBusy,setRecorderBusy] = useState(false);
 const [busy,setBusy] = useState(false);
 const [pipelineProgress,setPipelineProgress] = useState({done:0,total:0});
 const [elapsed,setElapsed] = useState(0);
 const selectedRef = useRef<string | null>(null);
 const latest = useRef<RecorderState | null>(null);
 const synced = useRef<RecorderState | null>(null);
 const recorderAction = useRef(false);
 const polling = useRef(false);
 const processing = useRef(false);
 const activeId = recording?.active ? recording.sessionId : null;
 const isRecording = activeId !== null;

 const refreshSessions = () => setSessions(listSessions());
 const refreshSelection = (sid: string) => {
  if (selectedRef.current !== sid) return;
  setSegments(listSegments(sid));
  setLines(getTranscript(sid));
 };
 const openSession = (sid: string) => {
  selectedRef.current = sid;
  setSelected(sid);
  refreshSelection(sid);
 };

 const applyNativeState = (state: RecorderState | null, notify: boolean) => {
  const previous = latest.current;
  if (state?.active && previous?.sessionId !== state.sessionId) {
   setElapsed(Math.max(0,Date.now()-state.startedAt));
  }
  latest.current = state;
  setRecording(state);

  const checkpoint = synced.current;
  if (state && state.status !== 'starting' &&
      (checkpoint?.sessionId !== state.sessionId || checkpoint.status !== state.status || checkpoint.segments !== state.segments)) {
   syncRecording(state);
   synced.current = state;
   refreshSessions();
   if (!selectedRef.current && state.active) openSession(state.sessionId);
   else refreshSelection(state.sessionId);
   if (notify && previous?.active && state.status === 'interrupted') {
    Alert.alert('Rekaman terputus',state.error ?? 'Periksa segmen yang tersimpan.');
   }
  }
 };

 useEffect(() => {
  let mounted = true;
  const startup = async () => {
   try {
    const current = await nativeRecorder.getState();
    if (!mounted) return;
    latest.current = current;
    setRecording(current);
    initializeDb();
    const recovered = await nativeRecorder.recover();
    if (!mounted) return;
    for (const state of recovered) syncRecording(state,true);
    const state = await nativeRecorder.getState();
    if (!mounted) return;
    applyNativeState(state,false);
    reconcileInactiveSessions(state?.active ? state.sessionId : null);
    refreshSessions();
    setReady(true);
   } catch {
    if (mounted) Alert.alert('Pemulihan gagal','Tutup dan buka kembali NotulenKu untuk mencoba lagi.');
   }
  };
  void startup();
  return () => {mounted = false;};
 },[]);

 useEffect(() => {
  if (!ready) return;
  let mounted = true;
  const timer = setInterval(async () => {
   if (polling.current || recorderAction.current) return;
   polling.current = true;
   try {
    const state = await nativeRecorder.getState();
    if (mounted && !recorderAction.current) applyNativeState(state,true);
   } catch {
    console.warn('Recorder state could not be synchronized');
   } finally {
    polling.current = false;
   }
  },1200);
  return () => {mounted = false; clearInterval(timer);};
 },[ready]);

 useEffect(() => {
  if (!activeId) return;
  const clock = setInterval(() => {
   if (latest.current?.active) setElapsed(Math.max(0,Date.now()-latest.current.startedAt));
  },500);
  return () => clearInterval(clock);
 },[activeId]);

 const begin = async () => {
  if (!ready || recorderAction.current || processing.current) return;
  recorderAction.current = true;
  setRecorderBusy(true);
  try {
   const permission = await AudioModule.requestRecordingPermissionsAsync();
   if (!permission.granted) {
    Alert.alert('Izin diperlukan','Izinkan mikrofon untuk merekam.');
    return;
   }
   const current = await nativeRecorder.getState();
   applyNativeState(current,false);
   if (current?.active) return;
   const id = 'nk_'+Date.now();
   await nativeRecorder.start(id,180);
   // Dispatching a foreground-service intent does not acknowledge a running MediaRecorder.
   const deadline = Date.now()+20_000;
   do {
    const state = await nativeRecorder.getState();
    if (state?.sessionId === id && state.status !== 'starting') {
     applyNativeState(state,false);
     if (!state.active) throw new Error(state.error ?? 'Perekam Android berhenti.');
     openSession(id);
     return;
    }
    await new Promise(resolve => setTimeout(resolve,100));
   } while (Date.now() < deadline);
   // Polling will adopt a late acknowledgement without covering the Stop button with a modal.
   console.warn('Recorder start is awaiting Android confirmation');
  } catch (error) {
   Alert.alert('Gagal mulai',message(error));
  } finally {
   recorderAction.current = false;
   setRecorderBusy(false);
  }
 };

 const end = async () => {
  if (recorderAction.current) return;
  const sid = latest.current?.active ? latest.current.sessionId : null;
  if (!sid) return;
  recorderAction.current = true;
  setRecorderBusy(true);
  try {
   await nativeRecorder.stop(sid);
   const state = await nativeRecorder.getState();
   applyNativeState(state,false);
   if (state?.sessionId !== sid || state.active) throw new Error('Perekam belum mengonfirmasi penghentian.');
   if (state.status === 'recorded') Alert.alert('Rekaman disimpan','Segmen native disinkronkan ke SQLite.');
   else Alert.alert('Rekaman terputus',state.error ?? 'Periksa segmen yang tersimpan.');
  } catch (error) {
   Alert.alert('Gagal menyelesaikan rekaman',message(error));
  } finally {
   recorderAction.current = false;
   setRecorderBusy(false);
  }
 };

 const process = async (sid: string, retry = false) => {
  if (processing.current || recorderAction.current || latest.current?.sessionId === sid && latest.current.active) return;
  processing.current = true;
  setBusy(true);
  try {
   setPipelineProgress({done:0,total:0});
   const candidates = listSegments(sid);
   await transcribePending(sid,retry ? candidates.filter(segment => segment.status === 'failed') : candidates,
    (done,total)=>setPipelineProgress({done,total}));
   refreshSelection(sid);
   Alert.alert('Pipeline selesai','Segmen yang gagal dapat dicoba ulang.');
  } catch (error) {
   Alert.alert('Pipeline gagal',message(error));
  } finally {
   processing.current = false;
   setBusy(false);
  }
 };

 const summary = async (sid: string) => {
  if (processing.current || recorderAction.current || latest.current?.sessionId === sid && latest.current.active) return;
  const inputs = listSegments(sid);
  if (!getTranscript(sid).length || inputs.some(segment => segment.status !== 'completed')) {
   Alert.alert('Ringkasan belum tersedia','Selesaikan transkripsi sesi terlebih dahulu.');
   return;
  }
  processing.current = true;
  setPipelineProgress({done:0,total:0});
  setBusy(true);
  try {
   const result = await summarizeSession(sid);
   if (selectedRef.current === sid) Alert.alert('Ringkasan AI',JSON.stringify(result).slice(0,3000));
  } catch (error) {
   if (selectedRef.current === sid) Alert.alert('Ringkasan belum tersedia',message(error));
  } finally {
   processing.current = false;
   setBusy(false);
  }
 };
 return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}>
  <View style={styles.header}><Image source={require('../assets/notulenku-logo.jpg')} style={styles.logo} resizeMode="contain"/><View style={styles.avatar}><Text style={styles.avatarText}>N</Text></View></View>
  <Text style={styles.greeting}>Ruang rapat cerdas</Text><Text style={styles.sub}>Rekam · pecah segmen · transkripsikan · rangkum</Text>
  <View style={styles.hero}><Text style={styles.badge}>NOTULENKU EXPO LAB</Text><Text style={styles.heroTitle}>{isRecording?'Rekaman sedang berlangsung':'Semua detail rapat, tertangkap.'}</Text><Text style={styles.heroDesc}>Rekaman dikelola service Android native. File segmen disimpan lokal.</Text>
   <View style={styles.timer}><Text style={styles.timerLabel}>DURASI SESI</Text><Text style={styles.timerValue}>{fmt(elapsed)}</Text><Text style={styles.timerNote}>{isRecording?'● REC ACTIVE':'READY'}</Text></View>
   <Pressable style={[styles.button,isRecording&&styles.stopButton]} onPress={isRecording?end:begin} disabled={recorderBusy||(!isRecording&&(!ready||busy))}><Text style={styles.buttonText}>{recorderBusy?(isRecording?'Menyimpan rekaman…':'Menyiapkan perekam…'):(isRecording?'■  Akhiri rekaman':'●  Mulai rekaman')}</Text></Pressable>
  </View>
  {selected&&selected!==activeId&&<View style={styles.panel}><Text style={styles.panelTitle}>Session tools</Text><Text style={styles.panelSub}>{selected}</Text><Pressable style={styles.secondaryButton} onPress={()=>process(selected)} disabled={busy}><Text style={styles.secondaryText}>{busy?'Memproses…':'Transkripsikan segmen tersimpan'}</Text></Pressable><Pressable style={styles.secondaryButton} onPress={()=>process(selected,true)} disabled={busy}><Text style={styles.secondaryText}>Retry segmen gagal</Text></Pressable><Pressable style={styles.secondaryButton} onPress={()=>summary(selected)} disabled={busy}><Text style={styles.secondaryText}>Buat ringkasan AI</Text></Pressable></View>}
  {busy&&<View style={{margin:12,alignItems:'center'}}><ActivityIndicator color="#2765D9"/><Text style={{color:'#718096',marginTop:8}}>{pipelineProgress.total?`Pipeline ${pipelineProgress.done}/${pipelineProgress.total}`:'Menyiapkan pipeline…'}</Text></View>}
  {segments.length>0&&<View style={styles.panel}><Text style={styles.panelTitle}>Segment checkpoint</Text><Text style={styles.panelSub}>Segmen lokal untuk sesi yang dipilih</Text>{segments.map((s,i)=><View key={s.id} style={styles.row}><View style={{flex:1}}><Text style={styles.segTitle}>Segment {i+1}</Text><Text style={styles.segSub}>{s.status} · {s.durationMs?fmt(s.durationMs):'durasi n/a'} · {s.uri?'file ada':'file hilang'}</Text>{s.error&&<Text style={styles.error}>{s.error}</Text>}</View><Text style={styles.status}>{s.status==='completed'?'✓':s.status.toUpperCase()}</Text></View>)}</View>}
  {lines.length>0&&<View style={styles.panel}><Text style={styles.panelTitle}>Transcript</Text>{lines.map((l,i)=><View key={i} style={styles.transcriptRow}><Text style={styles.speaker}>{l.speaker}</Text><Text style={styles.transcript}>{l.text}</Text></View>)}</View>}
  <View style={styles.panel}><View style={styles.listHeader}><Text style={styles.panelTitle}>Riwayat sesi</Text><Pressable onPress={refreshSessions}><Text style={styles.link}>Refresh</Text></Pressable></View>{sessions.length===0?<Text style={styles.empty}>Belum ada sesi lokal.</Text>:sessions.map(s=><Pressable key={s.id} style={styles.historyRow} onPress={()=>openSession(s.id)}><View style={{flex:1}}><Text style={styles.segTitle}>{s.title||'Rapat baru'}</Text><Text style={styles.segSub}>{new Date(s.startedAt).toLocaleString()} · {s.status}</Text></View><Text style={styles.link}>Buka ›</Text></Pressable>)}</View>
  <View style={styles.warning}><Text style={styles.warningTitle}>Native integration draft — belum diuji</Text><Text style={styles.warningText}>Build development diperlukan. Service native melakukan rotasi file; bridge merekonsiliasi metadata ke SQLite. Belum diuji pada perangkat, panggilan masuk, crash recovery, atau durasi panjang. Pipeline STT masih memerlukan endpoint.</Text></View>
 </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({safe:{flex:1,backgroundColor:'#F7F9FC'},page:{padding:22,paddingBottom:40},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},logo:{width:130,height:66},avatar:{width:40,height:40,borderRadius:20,backgroundColor:'#E7EEFA',alignItems:'center',justifyContent:'center'},avatarText:{fontWeight:'800',color:'#244A83'},greeting:{fontSize:26,fontWeight:'800',color:'#14243A',marginTop:20},sub:{fontSize:14,color:'#718096',marginTop:6},hero:{marginTop:24,backgroundColor:'#EAF2FF',borderRadius:26,padding:22,borderWidth:1,borderColor:'#D7E6FC'},badge:{fontSize:10,fontWeight:'800',letterSpacing:1,color:'#42679B'},heroTitle:{fontSize:24,fontWeight:'800',color:'#19365D',marginTop:16},heroDesc:{fontSize:14,lineHeight:21,color:'#607796',marginTop:8},timer:{backgroundColor:'#fff',borderRadius:20,padding:20,alignItems:'center',marginTop:20},timerLabel:{fontSize:10,letterSpacing:1,fontWeight:'800',color:'#8091A7'},timerValue:{fontSize:38,fontWeight:'800',color:'#1D3555',marginTop:8,fontVariant:['tabular-nums']},timerNote:{fontSize:12,color:'#3472D3',fontWeight:'800',marginTop:8},button:{backgroundColor:'#2765D9',padding:17,borderRadius:16,alignItems:'center',marginTop:18},stopButton:{backgroundColor:'#C73D4B'},buttonText:{color:'#fff',fontSize:15,fontWeight:'800'},panel:{marginTop:18,backgroundColor:'#fff',borderRadius:22,padding:18,borderWidth:1,borderColor:'#E7EDF5'},panelTitle:{fontSize:16,fontWeight:'800',color:'#24364D'},panelSub:{fontSize:11,color:'#8091A7',marginTop:5,marginBottom:10},secondaryButton:{backgroundColor:'#EFF5FF',borderRadius:13,padding:14,marginTop:9},secondaryText:{fontWeight:'700',color:'#2765D9',fontSize:13},row:{flexDirection:'row',alignItems:'center',paddingVertical:12,borderTopWidth:1,borderTopColor:'#EEF2F7'},segTitle:{fontSize:13,fontWeight:'700',color:'#34465E'},segSub:{fontSize:11,color:'#8091A7',marginTop:4},status:{fontSize:11,fontWeight:'800',color:'#3472D3'},error:{fontSize:10,color:'#C73D4B',marginTop:3},transcriptRow:{paddingVertical:11,borderTopWidth:1,borderTopColor:'#EEF2F7'},speaker:{fontSize:11,fontWeight:'800',color:'#2765D9'},transcript:{fontSize:13,lineHeight:19,color:'#394A60',marginTop:4},listHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},historyRow:{flexDirection:'row',alignItems:'center',paddingVertical:12,borderTopWidth:1,borderTopColor:'#EEF2F7'},link:{color:'#2765D9',fontWeight:'700',fontSize:12},empty:{color:'#94A3B8',fontSize:13,paddingVertical:12},warning:{marginTop:16,backgroundColor:'#FFF8EA',borderColor:'#F3E4C6',borderWidth:1,borderRadius:18,padding:16},warningTitle:{fontWeight:'800',color:'#8B6424'},warningText:{fontSize:12,lineHeight:19,color:'#9B7C4C',marginTop:6}});
