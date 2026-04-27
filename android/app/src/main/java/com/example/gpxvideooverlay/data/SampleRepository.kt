package com.example.gpxvideooverlay.data

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.exifinterface.media.ExifInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private data class StoreState(
    val activities: List<ActivityItem>,
    val media: List<MediaItem>,
)

class SampleRepository(private val context: Context) {
    private val storageFile = File(context.filesDir, "activities_store.json")

    var activities by mutableStateOf<List<ActivityItem>>(emptyList())
        private set

    var mediaItems by mutableStateOf<List<MediaItem>>(emptyList())
        private set

    init {
        val state = loadState()
        activities = state.activities.sortedByDescending { it.startedAtMs }
        mediaItems = state.media
    }

    fun connectStravaPlaceholder(): String {
        return "Strava-Login wird als naechstes per OAuth eingebaut."
    }

    fun importGpxFromUri(uri: Uri, displayName: String): ActivityItem {
        val sourceName = displayName.ifBlank { "Aktivitaet" }
        val pointCount = readTrackPointCount(uri)
        val now = System.currentTimeMillis()
        val item = ActivityItem(
            id = "act-${now}",
            title = sourceName.removeSuffix(".gpx").ifBlank { "Neue Aktivitaet" },
            subtitle = if (pointCount > 0) "GPX importiert · $pointCount Punkte" else "GPX importiert",
            distanceLabel = "-",
            dateLabel = now.toDateLabel(),
            startedAtMs = now,
            type = inferTypeFromName(sourceName),
        )

        activities = listOf(item) + activities
        persist()
        return item
    }

    fun importPhotosToActivity(activityId: String, uris: List<Uri>): Int {
        if (uris.isEmpty()) {
            return 0
        }

        val now = System.currentTimeMillis()
        val additions = uris.mapIndexed { index, uri ->
            val name = queryDisplayName(uri).ifBlank { "Bild ${index + 1}" }
            val capturedAt = readExifDateTime(uri) ?: now
            MediaItem(
                id = "media-${now}-${index}",
                activityId = activityId,
                uri = uri.toString(),
                displayName = name,
                capturedAtMs = capturedAt,
            )
        }

        mediaItems = mediaItems + additions
        persist()
        return additions.size
    }

    fun autoAssignPhotos(uris: List<Uri>): Pair<Int, Int> {
        if (uris.isEmpty()) {
            return 0 to 0
        }

        var assigned = 0
        var skipped = 0
        val additions = mutableListOf<MediaItem>()

        uris.forEachIndexed { index, uri ->
            val name = queryDisplayName(uri).ifBlank { "Bild ${index + 1}" }
            val capturedAt = readExifDateTime(uri) ?: System.currentTimeMillis()
            val target = nearestActivityFor(capturedAt)
            if (target == null) {
                skipped += 1
                return@forEachIndexed
            }

            additions += MediaItem(
                id = "media-${capturedAt}-${index}",
                activityId = target.id,
                uri = uri.toString(),
                displayName = name,
                capturedAtMs = capturedAt,
            )
            assigned += 1
        }

        if (additions.isNotEmpty()) {
            mediaItems = mediaItems + additions
            persist()
        }

        return assigned to skipped
    }

    fun mediaForActivity(activityId: String): List<MediaItem> {
        return mediaItems
            .filter { it.activityId == activityId }
            .sortedBy { it.capturedAtMs }
    }

    private fun nearestActivityFor(timestampMs: Long): ActivityItem? {
        return activities.minByOrNull { kotlin.math.abs(it.startedAtMs - timestampMs) }
    }

    private fun readTrackPointCount(uri: Uri): Int {
        return try {
            context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { reader ->
                val text = reader.readText()
                Regex("<trkpt\\b").findAll(text).count() + Regex("<rtept\\b").findAll(text).count()
            } ?: 0
        } catch (_: Exception) {
            0
        }
    }

    private fun readExifDateTime(uri: Uri): Long? {
        return try {
            context.contentResolver.openInputStream(uri)?.use { input ->
                val exif = ExifInterface(input)
                val value = exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL)
                    ?: exif.getAttribute(ExifInterface.TAG_DATETIME)
                    ?: return null

                val parser = SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.US)
                parser.parse(value)?.time
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun queryDisplayName(uri: Uri): String {
        return try {
            context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val idx = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                        if (idx >= 0) cursor.getString(idx) ?: "" else ""
                    } else {
                        ""
                    }
                } ?: ""
        } catch (_: Exception) {
            ""
        }
    }

    private fun inferTypeFromName(name: String): ActivityType {
        val n = name.lowercase(Locale.getDefault())
        return when {
            n.contains("run") || n.contains("lauf") -> ActivityType.Run
            n.contains("hike") || n.contains("wander") -> ActivityType.Hike
            else -> ActivityType.Ride
        }
    }

    private fun loadState(): StoreState {
        if (!storageFile.exists()) {
            return StoreState(emptyList(), emptyList())
        }

        return try {
            val raw = storageFile.readText()
            if (raw.isBlank()) {
                StoreState(emptyList(), emptyList())
            } else {
                val root = JSONObject(raw)
                val actsArray = root.optJSONArray("activities") ?: JSONArray()
                val mediaArray = root.optJSONArray("media") ?: JSONArray()

                val acts = buildList {
                    for (i in 0 until actsArray.length()) {
                        add(actsArray.getJSONObject(i).toActivityItem())
                    }
                }
                val media = buildList {
                    for (i in 0 until mediaArray.length()) {
                        add(mediaArray.getJSONObject(i).toMediaItem())
                    }
                }

                StoreState(acts, media)
            }
        } catch (_: Exception) {
            StoreState(emptyList(), emptyList())
        }
    }

    private fun persist() {
        val root = JSONObject().apply {
            put("activities", JSONArray().also { array ->
                activities.forEach { array.put(it.toJson()) }
            })
            put("media", JSONArray().also { array ->
                mediaItems.forEach { array.put(it.toJson()) }
            })
        }

        storageFile.writeText(root.toString(2))
    }
}

private fun ActivityItem.toJson(): JSONObject = JSONObject().apply {
    put("id", id)
    put("title", title)
    put("subtitle", subtitle)
    put("distanceLabel", distanceLabel)
    put("dateLabel", dateLabel)
    put("startedAtMs", startedAtMs)
    put("type", type.name)
}

private fun MediaItem.toJson(): JSONObject = JSONObject().apply {
    put("id", id)
    put("activityId", activityId)
    put("uri", uri)
    put("displayName", displayName)
    put("capturedAtMs", capturedAtMs)
}

private fun JSONObject.toActivityItem(): ActivityItem = ActivityItem(
    id = getString("id"),
    title = getString("title"),
    subtitle = getString("subtitle"),
    distanceLabel = getString("distanceLabel"),
    dateLabel = getString("dateLabel"),
    startedAtMs = optLong("startedAtMs", System.currentTimeMillis()),
    type = ActivityType.valueOf(getString("type")),
)

private fun JSONObject.toMediaItem(): MediaItem = MediaItem(
    id = getString("id"),
    activityId = getString("activityId"),
    uri = getString("uri"),
    displayName = getString("displayName"),
    capturedAtMs = optLong("capturedAtMs", System.currentTimeMillis()),
)

private fun Long.toDateLabel(): String {
    val formatter = SimpleDateFormat("dd.MM.yyyy", Locale.GERMANY)
    return formatter.format(Date(this))
}
