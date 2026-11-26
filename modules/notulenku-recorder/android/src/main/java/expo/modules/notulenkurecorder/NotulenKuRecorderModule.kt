package expo.modules.notulenkurecorder

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NotulenKuRecorderModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NotulenKuRecorder")

        AsyncFunction("start") { sessionId: String, segmentSeconds: Int ->
            val context = checkNotNull(appContext.reactContext)
            check(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                "Izin mikrofon diperlukan."
            }
            require(RecordingRecovery.sessionName.matches(sessionId)) { "ID sesi tidak valid." }
            val state = NotulenKuRecordingService.state
            check(state == null || !state.active) { "Rekaman sedang berlangsung." }
            val intent = Intent(context, NotulenKuRecordingService::class.java).apply {
                action = NotulenKuRecordingService.START
                putExtra("sessionId", sessionId)
                putExtra("segmentSeconds", segmentSeconds)
            }
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
            Unit
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("stop") { sessionId: String ->
            NotulenKuRecordingService.stopRecording(sessionId)
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("getState") {
            NotulenKuRecordingService.state?.toMap()
        }.runOnQueue(Queues.MAIN)

        AsyncFunction("recover") {
            val context = checkNotNull(appContext.reactContext)
            RecordingRecovery.recover(context, NotulenKuRecordingService.state?.sessionId)
                .map { it.toMap() }
        }
    }
}
