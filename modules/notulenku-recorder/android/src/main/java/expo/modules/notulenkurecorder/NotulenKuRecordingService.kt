package expo.modules.notulenkurecorder

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import java.io.File
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

class NotulenKuRecordingService : Service() {
    private data class Capture(val recorder: MediaRecorder, val file: File, val index: Int, val start: Long, val offset: Long)

    private var capture: Capture? = null
    private var directory: File? = null
    private var nextIndex = 0
    private var startedElapsed = 0L
    private val handler = Handler(Looper.getMainLooper())
    private val rotate = Runnable { rotateSegment() }

    companion object {
        const val START = "START"
        private const val CHANNEL = "nk_native_recording"
        private const val NOTIFICATION_ID = 9137

        @Volatile internal var state: RecordingState? = null
            private set
        private var service: NotulenKuRecordingService? = null

        internal fun stopRecording(sessionId: String) {
            if (state?.active == true && state?.sessionId == sessionId) service?.stopSession()
        }
    }

    override fun onCreate() {
        super.onCreate()
        service = this
        if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(CHANNEL, "NotulenKu Recording", NotificationManager.IMPORTANCE_LOW)
            )
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (capture != null) return START_NOT_STICKY
        val sessionId = intent?.getStringExtra("sessionId")
        if (intent?.action != START || sessionId == null || !RecordingRecovery.sessionName.matches(sessionId)) {
            stopSelf()
            return START_NOT_STICKY
        }

        val seconds = intent.getIntExtra("segmentSeconds", 180).coerceIn(30, 600)
        val startedAt = System.currentTimeMillis()
        val session = RecordingState(sessionId, startedAt, seconds, "starting", JSONArray())
        state = session
        startedElapsed = SystemClock.elapsedRealtime()
        try {
            startForeground(NOTIFICATION_ID, notification())
            val target = File(RecordingRecovery.root(this), sessionId)
            // A repeated or restored start must never reuse a directory containing audio.
            check(target.mkdirs()) { "Recording directory already exists or could not be created" }
            directory = target
            nextIndex = 0
            startSegment(session)
        } catch (_: Exception) {
            stopSession("Rekaman tidak dapat dimulai.")
        }
        return START_NOT_STICKY
    }

    private fun notification(): Notification {
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        return builder.setContentTitle("NotulenKu").setContentText("Rekaman rapat aktif — disimpan lokal")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now).setOngoing(true).build()
    }

    private fun startSegment(session: RecordingState) {
        val target = checkNotNull(directory)
        val index = nextIndex++
        val file = File(target, String.format(Locale.ROOT, "segment_%04d.m4a", index))
        check(file.createNewFile()) { "Recording file already exists" }
        val recorder = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(this) else MediaRecorder()
        try {
            recorder.setOnErrorListener { source, _, _ ->
                if (capture?.recorder === source) stopSession("Perekam Android mengalami gangguan.")
            }
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setAudioEncodingBitRate(128000)
            recorder.setAudioSamplingRate(44100)
            recorder.setOutputFile(file.absolutePath)
            recorder.prepare()
            val offset = (SystemClock.elapsedRealtime() - startedElapsed).coerceAtLeast(0)
            val start = session.startedAt + offset
            val active = session.copy(status = "recording")
            val pending = JSONObject().put("index", index).put("startedAtMs", start).put("offsetMs", offset)
            RecordingRecovery.save(target, active, pending)
            recorder.start()
            val actualOffset = (SystemClock.elapsedRealtime() - startedElapsed).coerceAtLeast(0)
            capture = Capture(recorder, file, index, session.startedAt + actualOffset, actualOffset)
            state = active
            handler.postDelayed(rotate, active.segmentSeconds * 1000L)
        } catch (failure: Exception) {
            runCatching { recorder.release() }
            throw failure
        }
    }

    private fun finishSegment(session: RecordingState): RecordingState {
        val current = capture ?: return session
        capture = null
        runCatching { current.recorder.stop() }
        runCatching { current.recorder.release() }
        val duration = RecordingRecovery.audioDuration(current.file)
            ?: return session.copy(error = "Ada segmen yang belum dapat dibaca. File lokal dipertahankan.")
        val segments = JSONArray(session.segments.toString())
        segments.put(RecordingRecovery.segment(current.file, current.index, current.start, duration, current.offset))
        return session.copy(segments = segments)
    }

    private fun rotateSegment() {
        val session = state?.takeIf { it.active } ?: return
        try {
            val checkpoint = finishSegment(session)
            state = checkpoint
            RecordingRecovery.save(checkNotNull(directory), checkpoint)
            startSegment(checkpoint)
        } catch (_: Exception) {
            stopSession("Segmen berikutnya tidak dapat dimulai.")
        }
    }

    private fun finalizeSession(error: String? = null) {
        val session = state ?: return
        val finished = finishSegment(session)
        val reason = error ?: finished.error
        val result = finished.copy(status = if (reason == null) "recorded" else "interrupted", error = reason)
        state = result
        directory?.let { target ->
            if (runCatching { RecordingRecovery.save(target, result) }.isFailure) {
                state = result.copy(status = "interrupted", error = "Metadata belum dapat disimpan. File lokal dipertahankan.")
            }
        }
    }

    private fun stopSession(error: String? = null) {
        handler.removeCallbacks(rotate)
        finalizeSession(error)
        directory = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        handler.removeCallbacks(rotate)
        if (capture != null) finalizeSession("Service perekam dihentikan.")
        if (service === this) service = null
        super.onDestroy()
    }
}
