package expo.modules.notulenkurecorder
import android.app.*;import android.content.*;import android.os.*;import android.media.MediaRecorder;import java.io.File;import org.json.JSONArray;import org.json.JSONObject
class NotulenKuRecordingService:Service(){
 private var recorder:MediaRecorder?=null;private var session="";private var seg=0;private var segmentSeconds=180;private var segmentStarted=0L;private var sessionStarted=0L;private val handler=Handler(Looper.getMainLooper());private val files=JSONArray();private var dir:File?=null
 companion object{const val CHANNEL="nk_native_recording";const val ID=9137}
 override fun onCreate(){super.onCreate();if(Build.VERSION.SDK_INT>=26){getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL,"NotulenKu Recording",NotificationManager.IMPORTANCE_LOW))}}
 override fun onStartCommand(i:Intent?,flags:Int,startId:Int):Int { when(i?.action){
 "START"->{if(recorder!=null)return START_STICKY
  session=i.getStringExtra("sessionId")?:System.currentTimeMillis().toString();segmentSeconds=(i.getIntExtra("segmentSeconds",180)).coerceIn(30,600)
  val prefs=getSharedPreferences("nk_native_rec",0);val previousSession=prefs.getString("sessionId","")?: "";sessionStarted=if(previousSession==session)prefs.getLong("startedAt",0L).takeIf{it>0}?:System.currentTimeMillis() else System.currentTimeMillis()
  if(previousSession==session){try{val saved=JSONArray(prefs.getString("segments","[]")?: "[]");for(j in 0 until saved.length())files.put(saved.getJSONObject(j))}catch(_:Exception){};seg=(0 until files.length()).mapNotNull{try{files.getJSONObject(it).optInt("index",-1)}catch(_:Exception){null}}.maxOrNull()?.plus(1)?:0}
  else seg=0
  dir=File(filesDir,"recordings/$session").apply{mkdirs()};startForeground(ID,notification());startSegment();handler.postDelayed(rotate,segmentSeconds*1000L);persist(true)
 }; "STOP"->stopSession()};return START_STICKY }
 private fun notification():Notification {val b=if(Build.VERSION.SDK_INT>=26)Notification.Builder(this,CHANNEL) else Notification.Builder(this);return b.setContentTitle("NotulenKu").setContentText("Rekaman rapat aktif — disimpan lokal").setSmallIcon(android.R.drawable.ic_btn_speak_now).build()}
 private fun startSegment(){try{val file=File(dir,"segment_${String.format("%04d",seg)}.m4a");val r=if(Build.VERSION.SDK_INT>=31)MediaRecorder(this) else MediaRecorder();r.setAudioSource(MediaRecorder.AudioSource.MIC);r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);r.setAudioEncodingBitRate(128000);r.setAudioSamplingRate(44100);r.setOutputFile(file.absolutePath);r.prepare();r.start();recorder=r;segmentStarted=System.currentTimeMillis();seg++;persist(true)}catch(e:Exception){stopSession()}}
 private val rotate=object:Runnable{override fun run(){if(recorder==null)return;finishSegment();startSegment();if(recorder!=null)handler.postDelayed(this,segmentSeconds*1000L)}}
 private fun finishSegment(){val r=recorder?:return;try{r.stop()}catch(_:Exception){};try{r.release()}catch(_:Exception){};recorder=null;val idx=seg-1;val f=File(dir,"segment_${String.format("%04d",idx)}.m4a");if(f.exists()&&f.length()>0){files.put(JSONObject().put("path",f.absolutePath).put("index",idx).put("bytes",f.length()).put("startedAtMs",segmentStarted).put("endedAtMs",System.currentTimeMillis()).put("offsetMs",segmentStarted-sessionStarted));persist(false)}}
 private fun persist(active:Boolean){getSharedPreferences("nk_native_rec",0).edit().putBoolean("active",active).putString("sessionId",session).putString("segments",files.toString()).putLong("startedAt",sessionStarted).putInt("segmentSeconds",segmentSeconds).apply()}
 private fun stopSession(){handler.removeCallbacks(rotate);finishSegment();persist(false);stopForeground(STOP_FOREGROUND_REMOVE);stopSelf()}
 override fun onBind(i:Intent?):IBinder?=null
 override fun onDestroy(){handler.removeCallbacks(rotate);super.onDestroy()}
}
