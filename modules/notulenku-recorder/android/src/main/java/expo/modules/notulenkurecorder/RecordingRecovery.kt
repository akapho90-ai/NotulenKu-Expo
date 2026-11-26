package expo.modules.notulenkurecorder

import android.content.Context
import android.media.MediaMetadataRetriever
import android.util.AtomicFile
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

internal data class RecordingState(
    val sessionId: String,
    val startedAt: Long,
    val segmentSeconds: Int,
    val status: String,
    val segments: JSONArray,
    val error: String? = null,
    val stopUncertain: Boolean = false
) {
    val active get() = status == "recording"

    fun toMap() = mapOf(
        "sessionId" to sessionId,
        "startedAt" to startedAt,
        "segmentSeconds" to segmentSeconds,
        "status" to status,
        "active" to active,
        "segments" to segments.toString(),
        "error" to error,
        "stopUncertain" to stopUncertain
    )
}

internal object RecordingRecovery {
    val sessionName = Regex("[A-Za-z0-9_-]+")
    private val segmentName = Regex("segment_([0-9]+)\\.m4a")

    fun segmentIndex(file: File) = segmentName.matchEntire(file.name)?.groupValues?.get(1)?.toIntOrNull()
    fun root(context: Context) = File(context.filesDir, "recordings")

    fun save(directory: File, state: RecordingState, pending: JSONObject? = null) {
        val checkpoint = AtomicFile(File(directory, "checkpoint.json"))
        val output = checkpoint.startWrite()
        try {
            val json = JSONObject().put("startedAt", state.startedAt).put("segmentSeconds", state.segmentSeconds)
                .put("status", state.status).put("segments", state.segments).put("pending", pending)
            output.write(json.toString().toByteArray(Charsets.UTF_8))
            checkpoint.finishWrite(output)
        } catch (failure: Exception) {
            checkpoint.failWrite(output)
            throw failure
        }
    }

    fun audioDuration(file: File): Long? {
        if (!file.isFile || file.length() == 0L) return null
        val reader = MediaMetadataRetriever()
        return try {
            reader.setDataSource(file.absolutePath)
            if (reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes") {
                reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?.takeIf { it > 0 }
            } else null
        } catch (_: Exception) {
            null
        } finally {
            runCatching { reader.release() }
        }
    }

    fun recover(context: Context, currentSession: String?): List<RecordingState> {
        val prefs = context.getSharedPreferences("nk_native_rec", Context.MODE_PRIVATE)
        val legacySession = prefs.getString("sessionId", "")
        return root(context).listFiles().orEmpty().mapNotNull { directory ->
            if (!directory.isDirectory || directory.name == currentSession || !sessionName.matches(directory.name)) {
                return@mapNotNull null
            }
            val checkpoint = runCatching {
                JSONObject(AtomicFile(File(directory, "checkpoint.json")).readFully().toString(Charsets.UTF_8))
            }.getOrNull()
            val legacy = directory.name == legacySession
            val legacySegments = if (legacy) runCatching {
                JSONArray(prefs.getString("segments", "[]"))
            }.getOrNull() else null
            val saved = checkpoint?.optJSONArray("segments") ?: legacySegments ?: JSONArray()
            val pending = checkpoint?.optJSONObject("pending")
            val metadata = (0 until saved.length()).mapNotNull(saved::optJSONObject).associateBy { it.optInt("index", -1) }
            val segments = JSONArray()
            var firstStart = checkpoint?.optLong("startedAt")?.takeIf { it > 0 }
                ?: (if (legacy) prefs.getLong("startedAt", 0).takeIf { it > 0 } else null)
            val seconds = checkpoint?.optInt("segmentSeconds", 180) ?: if (legacy) prefs.getInt("segmentSeconds", 180) else 180
            var lastEnd = 0L
            val files = directory.listFiles() ?: return@mapNotNull null
            val byIndex = files.sortedBy { it.name }.mapNotNull { file -> segmentIndex(file)?.let { it to file } }
                .distinctBy { it.first }.toMap()
            val pendingIndex = pending?.optInt("index", -1)?.takeIf { it >= 0 }
            val indices = (byIndex.keys + metadata.keys + listOfNotNull(pendingIndex)).filter { it >= 0 }.sorted()
            var complete = true
            for (index in indices) {
                val file = byIndex[index]
                val duration = file?.let(::audioDuration)
                val entry = metadata[index] ?: pending?.takeIf { pendingIndex == index }
                val knownStart = entry?.optLong("startedAtMs")?.takeIf { it > 0 }
                val start = knownStart
                    ?: file?.lastModified()?.takeIf { it > 0 }?.let { (it - (duration ?: 0)).coerceAtLeast(lastEnd) }
                    ?: continue
                if (firstStart == null) firstStart = start
                val offset = entry?.optLong("offsetMs", -1)?.takeIf { it >= 0 }
                    ?: (start - firstStart).coerceAtLeast(0)
                if (file != null && duration != null) {
                    lastEnd = start + duration
                    segments.put(segment(file, index, start, duration, offset).put("estimatedTiming", knownStart == null))
                } else {
                    complete = false
                    val end = entry?.optLong("endedAtMs")?.takeIf { it >= start } ?: start
                    segments.put(JSONObject().put("index", index).put("startedAtMs", start)
                        .put("endedAtMs", end).put("offsetMs", offset).put("estimatedTiming", knownStart == null))
                }
            }
            val startedAt = firstStart?.takeIf { it > 0 } ?: return@mapNotNull null
            val cleanStop = complete && checkpoint?.optString("status") == "recorded"
            val stopUncertain = complete && checkpoint == null && !(legacy && prefs.getBoolean("active", false))
            val status = if (cleanStop) {
                "recorded"
            } else {
                "interrupted"
            }
            RecordingState(directory.name, startedAt, seconds, status, segments, stopUncertain = stopUncertain)
        }
    }

    fun segment(file: File, index: Int, start: Long, duration: Long, offset: Long) =
        JSONObject().put("path", file.absolutePath).put("index", index).put("bytes", file.length())
            .put("startedAtMs", start).put("endedAtMs", start + duration).put("offsetMs", offset)
}
