import React,{useEffect,useState,useRef} from 'react';
import {SafeAreaView,View,Text,Image,ScrollView,Pressable,StyleSheet,Alert,ActivityIndicator} from 'react-native';
import {AudioModule} from 'expo-audio';
import {nativeRecorder} from '../src/services/nativeRecorder';
import {initializeDb,createSession,listSegments,listSessions,markSegment,getTranscript,syncNativeSegments,setSessionStatus} from '../src/services/db';
import {transcribePending,retryFailed} from '../src/services/transcription';
import {summarizeSession} from '../src/services/summary';
import type {Segment} from '../src/types';

const fmt=(ms:number)=>{const s=Math.floor(ms/1000);return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`};
export default function Home(){
 const [nativeActive,setNativeActive]=useState(false);
 const recStatus={isRecording:nativeActive};
 const [permission,setPermission]=useState(false);
 const [activeSession,setActiveSession]=useState<string|null>(null);
 const [currentSeg,setCurrentSeg]=useState<number|null>(null);
 const [seq,setSeq]=useState(0);
 const [segments,setSegments]=useState<Segment[]>([]);
 const [sessions,setSessions]=useState<any[]>([]);
 const [lines,setLines]=useState<any[]>([]);
 const [busy,setBusy]=useState(false);
 const [pipelineProgress,setPipelineProgress]=useState({done:0,total:0});
 const [elapsed,setElapsed]=useState(0);
 const nativeSegmentsRef=useRef<any[]>([]);
 const sessionStart=useRef<number|null>(null);
 const segStart=useRef<number|null>(null);
 useEffect(()=>{initializeDb();AudioModule.requestRecordingPermissionsAsync().then(x=>setPermission(x.granted)).catch(()=>{});refreshSessions()},[]);
 const refreshSessions=()=>setSessions(listSessions());
 const refreshSegments=(sid:string)=>setSegments(listSegments(sid));
 const pollNative=async(sid?:string)=>{try{const st=await nativeRecorder.getState();setNativeActive(!!st.active);if(st.sessionId){nativeSegmentsRef.current=typeof st.segments==='string'?JSON.parse(st.segments||'[]'):Array.from(st.segments||[]);syncNativeSegments(st.sessionId,nativeSegmentsRef.current,Number(st.segmentSeconds||180));if(sid)refreshSegments(sid);setCurrentSeg(st.active?Number(nativeSegmentsRef.current.length):null);}}catch(e){console.warn('native state poll',e)} };
 useEffect(()=>{const t=setInterval(()=>pollNative(activeSession||undefined),1200);return()=>clearInterval(t)},[activeSession]);
 const begin=async()=>{
  if(busy||recStatus.isRecording)return;
  try{
   let granted=permission;if(!granted){const p=await AudioModule.requestRecordingPermissionsAsync();granted=p.granted;setPermission(granted)}
   if(!granted){Alert.alert('Izin diperlukan','Izinkan mikrofon untuk merekam.');return}
   const id='nk_'+Date.now();createSession(id,'Rapat baru');setActiveSession(id);sessionStart.current=Date.now();setElapsed(0);setSeq(0);nativeSegmentsRef.current=[];
   await nativeRecorder.start(id,180);setNativeActive(true);refreshSessions();
  }catch(e:any){Alert.alert('Gagal mulai',e?.message||'')}
 };
 const end=async()=>{
  if(!activeSession)return;
  try{await nativeRecorder.stop();await new Promise(r=>setTimeout(r,700));await pollNative(activeSession);syncNativeSegments(activeSession,nativeSegmentsRef.current,180);setSessionStatus(activeSession,'recorded');setNativeActive(false);setActiveSession(null);setCurrentSeg(null);refreshSegments(activeSession);refreshSessions();Alert.alert('Rekaman disimpan','Segment native disinkronkan ke SQLite.');}
  catch(e:any){Alert.alert('Gagal menyelesaikan rekaman',e?.message||'')}
 };
 useEffect(()=>{
  if(!recStatus.isRecording||!activeSession)return;
  const clock=setInterval(()=>{if(sessionStart.current)setElapsed(Date.now()-sessionStart.current)},500);
  return()=>clearInterval(clock);
 },[recStatus.isRecording,activeSession]);
 const process=async(sid:string)=>{
  setBusy(true);
  try{refreshSegments(sid);setPipelineProgress({done:0,total:0});await transcribePending(sid,listSegments(sid),(done,total)=>setPipelineProgress({done,total}));refreshSegments(sid);setLines(getTranscript(sid));Alert.alert('Pipeline selesai','Segmen yang dapat diproses sudah diproses. Segmen gagal dapat dicoba ulang.')}
  catch(e:any){Alert.alert('Pipeline gagal',e?.message||'')}
  finally{setBusy(false)}
 };
 const retry=async(sid:string)=>{retryFailed(sid);await process(sid)};
 const summary=async(sid:string)=>{setBusy(true);try{const r=await summarizeSession(sid);Alert.alert('Ringkasan AI',JSON.stringify(r).slice(0,3000))}catch(e:any){Alert.alert('Ringkasan belum tersedia',e?.message||'')}finally{setBusy(false)}};
 const openSession=(sid:string)=>{setActiveSession(sid);refreshSegments(sid);setLines(getTranscript(sid));};
 return <SafeAreaView style={styles.safe}><ScrollView contentContainerStyle={styles.page}>
  <View style={styles.header}><Image source={require('../assets/notulenku-logo.jpg')} style={styles.logo} resizeMode="contain"/><View style={styles.avatar}><Text style={styles.avatarText}>N</Text></View></View>
  <Text style={styles.greeting}>Ruang rapat cerdas</Text><Text style={styles.sub}>Rekam · pecah segmen · transkripsikan · rangkum</Text>
  <View style={styles.hero}><Text style={styles.badge}>NOTULENKU EXPO LAB</Text><Text style={styles.heroTitle}>{recStatus.isRecording?'Rekaman sedang berlangsung':'Semua detail rapat, tertangkap.'}</Text><Text style={styles.heroDesc}>Rekaman dikelola service Android native. File segmen disimpan lokal.</Text>
   <View style={styles.timer}><Text style={styles.timerLabel}>DURASI SESI</Text><Text style={styles.timerValue}>{fmt(elapsed)}</Text><Text style={styles.timerNote}>{recStatus.isRecording?'● REC ACTIVE':'READY'}</Text></View>
   <Pressable style={[styles.button,recStatus.isRecording&&styles.stopButton]} onPress={recStatus.isRecording?end:begin}><Text style={styles.buttonText}>{recStatus.isRecording?'■  Akhiri rekaman':'●  Mulai rekaman'}</Text></Pressable>
  </View>
  {activeSession&&!recStatus.isRecording&&<View style={styles.panel}><Text style={styles.panelTitle}>Session tools</Text><Text style={styles.panelSub}>{activeSession}</Text><Pressable style={styles.secondaryButton} onPress={()=>process(activeSession)} disabled={busy}><Text style={styles.secondaryText}>{busy?'Memproses…':'Transkripsikan segmen tersimpan'}</Text></Pressable><Pressable style={styles.secondaryButton} onPress={()=>retry(activeSession)} disabled={busy}><Text style={styles.secondaryText}>Retry segmen gagal</Text></Pressable><Pressable style={styles.secondaryButton} onPress={()=>summary(activeSession)} disabled={busy}><Text style={styles.secondaryText}>Buat ringkasan AI</Text></Pressable></View>}
  {busy&&<View style={{margin:12,alignItems:'center'}}><ActivityIndicator color="#2765D9"/><Text style={{color:'#718096',marginTop:8}}>{pipelineProgress.total?`Pipeline ${pipelineProgress.done}/${pipelineProgress.total}`:'Menyiapkan pipeline…'}</Text></View>}
  {segments.length>0&&<View style={styles.panel}><Text style={styles.panelTitle}>Segment checkpoint</Text><Text style={styles.panelSub}>Segmen lokal untuk sesi yang dipilih</Text>{segments.map((s,i)=><View key={s.id} style={styles.row}><View style={{flex:1}}><Text style={styles.segTitle}>Segment {i+1}</Text><Text style={styles.segSub}>{s.status} · {s.durationMs?fmt(s.durationMs):'durasi n/a'} · {s.uri?'file ada':'file hilang'}</Text>{s.error&&<Text style={styles.error}>{s.error}</Text>}</View><Text style={styles.status}>{s.status==='completed'?'✓':s.status.toUpperCase()}</Text></View>)}</View>}
  {lines.length>0&&<View style={styles.panel}><Text style={styles.panelTitle}>Transcript</Text>{lines.map((l,i)=><View key={i} style={styles.transcriptRow}><Text style={styles.speaker}>{l.speaker}</Text><Text style={styles.transcript}>{l.text}</Text></View>)}</View>}
  <View style={styles.panel}><View style={styles.listHeader}><Text style={styles.panelTitle}>Riwayat sesi</Text><Pressable onPress={refreshSessions}><Text style={styles.link}>Refresh</Text></Pressable></View>{sessions.length===0?<Text style={styles.empty}>Belum ada sesi lokal.</Text>:sessions.map((s:any)=><Pressable key={s.id} style={styles.historyRow} onPress={()=>openSession(s.id)}><View style={{flex:1}}><Text style={styles.segTitle}>{s.title||'Rapat baru'}</Text><Text style={styles.segSub}>{new Date(s.startedAt).toLocaleString()} · {s.status}</Text></View><Text style={styles.link}>Buka ›</Text></Pressable>)}</View>
  <View style={styles.warning}><Text style={styles.warningTitle}>Native integration draft — belum diuji</Text><Text style={styles.warningText}>Build development diperlukan. Service native melakukan rotasi file; bridge merekonsiliasi metadata ke SQLite. Belum diuji pada perangkat, panggilan masuk, crash recovery, atau durasi panjang. Pipeline STT masih memerlukan endpoint.</Text></View>
 </ScrollView></SafeAreaView>;
}
const styles=StyleSheet.create({safe:{flex:1,backgroundColor:'#F7F9FC'},page:{padding:22,paddingBottom:40},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},logo:{width:130,height:66},avatar:{width:40,height:40,borderRadius:20,backgroundColor:'#E7EEFA',alignItems:'center',justifyContent:'center'},avatarText:{fontWeight:'800',color:'#244A83'},greeting:{fontSize:26,fontWeight:'800',color:'#14243A',marginTop:20},sub:{fontSize:14,color:'#718096',marginTop:6},hero:{marginTop:24,backgroundColor:'#EAF2FF',borderRadius:26,padding:22,borderWidth:1,borderColor:'#D7E6FC'},badge:{fontSize:10,fontWeight:'800',letterSpacing:1,color:'#42679B'},heroTitle:{fontSize:24,fontWeight:'800',color:'#19365D',marginTop:16},heroDesc:{fontSize:14,lineHeight:21,color:'#607796',marginTop:8},timer:{backgroundColor:'#fff',borderRadius:20,padding:20,alignItems:'center',marginTop:20},timerLabel:{fontSize:10,letterSpacing:1,fontWeight:'800',color:'#8091A7'},timerValue:{fontSize:38,fontWeight:'800',color:'#1D3555',marginTop:8,fontVariant:['tabular-nums']},timerNote:{fontSize:12,color:'#3472D3',fontWeight:'800',marginTop:8},button:{backgroundColor:'#2765D9',padding:17,borderRadius:16,alignItems:'center',marginTop:18},stopButton:{backgroundColor:'#C73D4B'},buttonText:{color:'#fff',fontSize:15,fontWeight:'800'},panel:{marginTop:18,backgroundColor:'#fff',borderRadius:22,padding:18,borderWidth:1,borderColor:'#E7EDF5'},panelTitle:{fontSize:16,fontWeight:'800',color:'#24364D'},panelSub:{fontSize:11,color:'#8091A7',marginTop:5,marginBottom:10},secondaryButton:{backgroundColor:'#EFF5FF',borderRadius:13,padding:14,marginTop:9},secondaryText:{fontWeight:'700',color:'#2765D9',fontSize:13},row:{flexDirection:'row',alignItems:'center',paddingVertical:12,borderTopWidth:1,borderTopColor:'#EEF2F7'},segTitle:{fontSize:13,fontWeight:'700',color:'#34465E'},segSub:{fontSize:11,color:'#8091A7',marginTop:4},status:{fontSize:11,fontWeight:'800',color:'#3472D3'},error:{fontSize:10,color:'#C73D4B',marginTop:3},transcriptRow:{paddingVertical:11,borderTopWidth:1,borderTopColor:'#EEF2F7'},speaker:{fontSize:11,fontWeight:'800',color:'#2765D9'},transcript:{fontSize:13,lineHeight:19,color:'#394A60',marginTop:4},listHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},historyRow:{flexDirection:'row',alignItems:'center',paddingVertical:12,borderTopWidth:1,borderTopColor:'#EEF2F7'},link:{color:'#2765D9',fontWeight:'700',fontSize:12},empty:{color:'#94A3B8',fontSize:13,paddingVertical:12},warning:{marginTop:16,backgroundColor:'#FFF8EA',borderColor:'#F3E4C6',borderWidth:1,borderRadius:18,padding:16},warningTitle:{fontWeight:'800',color:'#8B6424'},warningText:{fontSize:12,lineHeight:19,color:'#9B7C4C',marginTop:6}});
