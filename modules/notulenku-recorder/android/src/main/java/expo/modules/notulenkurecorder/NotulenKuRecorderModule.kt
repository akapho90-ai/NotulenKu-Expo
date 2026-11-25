package expo.modules.notulenkurecorder
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.content.Intent
import android.content.Context
import org.json.JSONArray
class NotulenKuRecorderModule:Module(){
 override fun definition()=ModuleDefinition { Name("NotulenKuRecorder")
 Function("start") { sessionId:String, segmentSeconds:Int ->
   val c=appContext.reactContext ?: throw Exception("Context unavailable")
   val i=Intent(c,NotulenKuRecordingService::class.java).apply{action="START";putExtra("sessionId",sessionId);putExtra("segmentSeconds",segmentSeconds)}
   if(android.os.Build.VERSION.SDK_INT>=26)c.startForegroundService(i) else c.startService(i); true
 }
 Function("stop") { val c=appContext.reactContext ?: throw Exception("Context unavailable");if(android.os.Build.VERSION.SDK_INT>=26)c.startService(Intent(c,NotulenKuRecordingService::class.java).apply{action="STOP"});true }
 Function("getState") { val c=appContext.reactContext ?: throw Exception("Context unavailable"); val f=c.getSharedPreferences("nk_native_rec",Context.MODE_PRIVATE); mapOf("active" to f.getBoolean("active",false),"sessionId" to (f.getString("sessionId",null)?:""),"segments" to (f.getString("segments","[]")?:"[]"),"startedAt" to f.getLong("startedAt",0L),"segmentSeconds" to f.getInt("segmentSeconds",180)) }
 } }
