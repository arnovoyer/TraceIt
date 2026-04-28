package com.example.gpxvideooverlay.data

import android.content.Context
import android.content.ContentUris
import android.net.Uri
import android.provider.MediaStore
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.exifinterface.media.ExifInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private data class StoreState(
    val activities: List<ActivityItem>,
    val media: List<MediaItem>,
    val routePointsByActivity: Map<String, List<RoutePoint>>,
)

class SampleRepository(private val context: Context) {
    private val storageFile = File(context.filesDir, "activities_store.json")

    var activities by mutableStateOf<List<ActivityItem>>(emptyList())
        private set

    var mediaItems by mutableStateOf<List<MediaItem>>(emptyList())
        private set

    var routePointsByActivity by mutableStateOf<Map<String, List<RoutePoint>>>(emptyMap())
        private set

    init {
        val state = loadState()
        activities = state.activities.sortedByDescending { it.startedAtMs }
        mediaItems = state.media
        routePointsByActivity = state.routePointsByActivity
    }

    fun connectStravaPlaceholder(): String {
        return "Strava-Login wird als naechstes per OAuth eingebaut."
    }

    fun importGpxFromUri(uri: Uri, displayName: String): ActivityItem {
        val sourceName = displayName.ifBlank { "Aktivitaet" }
        val gpxMeta = readGpxMeta(uri)
        if (!gpxMeta.isGpx) {
            throw IllegalArgumentException("Die ausgewaehlte Datei ist kein GPX.")
        }
        val parsedPoints = parseGpxRoutePoints(uri, context)
        val now = System.currentTimeMillis()
        val parsedStart = parsedPoints.firstOrNull { it.timeMs != null }?.timeMs
        val parsedEnd = parsedPoints.lastOrNull { it.timeMs != null }?.timeMs
        val startedAt = parsedStart ?: gpxMeta.startMs ?: now
        val endedAt = when {
            parsedEnd != null && parsedEnd >= startedAt -> parsedEnd
            gpxMeta.endMs != null && gpxMeta.endMs >= startedAt -> gpxMeta.endMs
            else -> startedAt + DEFAULT_ACTIVITY_DURATION_MS
        }
        val item = ActivityItem(
            id = "act-${now}",
            title = sourceName.removeSuffix(".gpx").ifBlank { "Neue Aktivitaet" },
            subtitle = if (gpxMeta.pointCount > 0) "GPX importiert · ${gpxMeta.pointCount} Punkte" else "GPX importiert",
            distanceLabel = "-",
            dateLabel = startedAt.toDateLabel(),
            startedAtMs = startedAt,
            endedAtMs = endedAt,
            type = inferTypeFromName(sourceName),
        )

        activities = listOf(item) + activities
        routePointsByActivity = routePointsByActivity + (item.id to parsedPoints)
        persist()
        return item
    }

    fun routePointsForActivity(activityId: String): List<RoutePoint> {
        return routePointsByActivity[activityId].orEmpty()
    }

    fun importPhotosToActivity(activityId: String, uris: List<Uri>, mode: TimestampMode): Int {
        if (uris.isEmpty()) {
            return 0
        }

        val activity = activities.firstOrNull { it.id == activityId } ?: return 0

        val now = System.currentTimeMillis()
        val existingKeys = mediaItems.map { "${it.activityId}|${it.uri}" }.toHashSet()
        val additions = uris.mapIndexed { index, uri ->
            val name = queryDisplayName(uri).ifBlank { "Bild ${index + 1}" }
            val exifTime = readExifDateTime(uri)
            val capturedAt = when (mode) {
                TimestampMode.Exif -> exifTime ?: now
                TimestampMode.ActivityStart -> activity.startedAtMs
                TimestampMode.Now -> now
            }
            MediaItem(
                id = "media-${now}-${index}",
                activityId = activityId,
                uri = uri.toString(),
                displayName = name,
                capturedAtMs = capturedAt,
            )
        }.filter { existingKeys.add("${it.activityId}|${it.uri}") }

        mediaItems = mediaItems + additions
        persist()
        return additions.size
    }

    fun importGalleryPhotosForActivity(activityId: String): Pair<Int, Int> {
        val activity = activities.firstOrNull { it.id == activityId } ?: return 0 to 0
        val start = activity.startedAtMs - GALLERY_TIME_TOLERANCE_MS
        val end = activity.endedAtMs + GALLERY_TIME_TOLERANCE_MS

        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_ADDED,
        )
        val selection = "${MediaStore.Images.Media.DATE_TAKEN} BETWEEN ? AND ?"
        val selectionArgs = arrayOf(start.toString(), end.toString())

        var scanned = 0
        val existingKeys = mediaItems.map { "${it.activityId}|${it.uri}" }.toHashSet()
        val additions = mutableListOf<MediaItem>()

        context.contentResolver.query(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            projection,
            selection,
            selectionArgs,
            "${MediaStore.Images.Media.DATE_TAKEN} ASC",
        )?.use { cursor ->
            val idIdx = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
            val nameIdx = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
            val takenIdx = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_TAKEN)
            val addedIdx = cursor.getColumnIndexOrThrow(MediaStore.Images.Media.DATE_ADDED)

            while (cursor.moveToNext()) {
                scanned += 1
                val imageId = cursor.getLong(idIdx)
                val imageUri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, imageId)
                val key = "${activityId}|${imageUri}"
                if (!existingKeys.add(key)) {
                    continue
                }

                val takenMs = cursor.getLong(takenIdx)
                val addedSeconds = cursor.getLong(addedIdx)
                val capturedAt = if (takenMs > 0L) takenMs else addedSeconds * 1000L
                val displayName = cursor.getString(nameIdx).orEmpty().ifBlank { "Bild $imageId" }

                additions += MediaItem(
                    id = "media-gallery-${activityId}-${imageId}",
                    activityId = activityId,
                    uri = imageUri.toString(),
                    displayName = displayName,
                    capturedAtMs = capturedAt,
                )
            }
        }

        if (additions.isNotEmpty()) {
            mediaItems = mediaItems + additions
            persist()
        }

        return additions.size to scanned
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

    private fun readGpxMeta(uri: Uri): GpxMeta {
        return try {
            context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { reader ->
                val text = reader.readText()
                val pointCount = Regex("<trkpt\\b").findAll(text).count() + Regex("<rtept\\b").findAll(text).count()
                val isGpx = Regex("<gpx\\b", RegexOption.IGNORE_CASE).containsMatchIn(text)
                val timestamps = Regex("<time>([^<]+)</time>")
                    .findAll(text)
                    .mapNotNull { match -> parseIsoTime(match.groupValues[1]) }
                    .toList()

                GpxMeta(
                    pointCount = pointCount,
                    startMs = timestamps.minOrNull(),
                    endMs = timestamps.maxOrNull(),
                    isGpx = isGpx,
                )
            } ?: GpxMeta(0, null, null, false)
        } catch (_: Exception) {
            GpxMeta(0, null, null, false)
        }
    }

    private fun parseIsoTime(raw: String): Long? {
        return try {
            Instant.parse(raw.trim()).toEpochMilli()
        } catch (_: Exception) {
            null
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
            return StoreState(emptyList(), emptyList(), emptyMap())
        }

        return try {
            val raw = storageFile.readText()
            if (raw.isBlank()) {
                StoreState(emptyList(), emptyList(), emptyMap())
            } else {
                val root = JSONObject(raw)
                val actsArray = root.optJSONArray("activities") ?: JSONArray()
                val mediaArray = root.optJSONArray("media") ?: JSONArray()
                val routesObject = root.optJSONObject("routes") ?: JSONObject()

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

                val routes = mutableMapOf<String, List<RoutePoint>>()
                val keys = routesObject.keys()
                while (keys.hasNext()) {
                    val activityId = keys.next()
                    val pointsArray = routesObject.optJSONArray(activityId) ?: JSONArray()
                    val points = buildList {
                        for (i in 0 until pointsArray.length()) {
                            add(pointsArray.getJSONObject(i).toRoutePoint())
                        }
                    }
                    routes[activityId] = points
                }

                StoreState(acts, media, routes)
            }
        } catch (_: Exception) {
            StoreState(emptyList(), emptyList(), emptyMap())
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
            put("routes", JSONObject().also { routes ->
                routePointsByActivity.forEach { (activityId, points) ->
                    routes.put(activityId, JSONArray().also { array ->
                        points.forEach { point -> array.put(point.toJson()) }
                    })
                }
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
    put("endedAtMs", endedAtMs)
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
    endedAtMs = optLong("endedAtMs", optLong("startedAtMs", System.currentTimeMillis()) + DEFAULT_ACTIVITY_DURATION_MS),
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

private data class GpxMeta(
    val pointCount: Int,
    val startMs: Long?,
    val endMs: Long?,
    val isGpx: Boolean,
)

private fun RoutePoint.toJson(): JSONObject = JSONObject().apply {
    put("lat", lat)
    put("lon", lon)
    if (ele != null) put("ele", ele)
    if (timeMs != null) put("timeMs", timeMs)
}

private fun JSONObject.toRoutePoint(): RoutePoint = RoutePoint(
    lat = getDouble("lat"),
    lon = getDouble("lon"),
    ele = if (has("ele")) optDouble("ele") else null,
    timeMs = if (has("timeMs")) optLong("timeMs") else null,
)

private fun parseGpxRoutePoints(uri: Uri, context: Context): List<RoutePoint> {
    return try {
        val xml = context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }.orEmpty()
        if (xml.isBlank()) return emptyList()

        val trackPointRegex = Regex("<trkpt\\s+[^>]*lat=\"([^\"]+)\"[^>]*lon=\"([^\"]+)\"[^>]*>(.*?)</trkpt>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
        val routePointRegex = Regex("<rtept\\s+[^>]*lat=\"([^\"]+)\"[^>]*lon=\"([^\"]+)\"[^>]*>(.*?)</rtept>", setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
        val eleRegex = Regex("<ele>([^<]+)</ele>", RegexOption.IGNORE_CASE)
        val timeRegex = Regex("<time>([^<]+)</time>", RegexOption.IGNORE_CASE)

        fun parsePoints(matches: Sequence<MatchResult>): List<RoutePoint> {
            return matches.mapNotNull { m ->
                val lat = m.groupValues.getOrNull(1)?.toDoubleOrNull() ?: return@mapNotNull null
                val lon = m.groupValues.getOrNull(2)?.toDoubleOrNull() ?: return@mapNotNull null
                val inner = m.groupValues.getOrNull(3).orEmpty()
                val ele = eleRegex.find(inner)?.groupValues?.getOrNull(1)?.toDoubleOrNull()
                val timeMs = timeRegex.find(inner)?.groupValues?.getOrNull(1)?.let { raw ->
                    try {
                        Instant.parse(raw.trim()).toEpochMilli()
                    } catch (_: Exception) {
                        null
                    }
                }
                RoutePoint(lat = lat, lon = lon, ele = ele, timeMs = timeMs)
            }.toList()
        }

        val trkPoints = parsePoints(trackPointRegex.findAll(xml))
        if (trkPoints.isNotEmpty()) trkPoints else parsePoints(routePointRegex.findAll(xml))
    } catch (_: Exception) {
        emptyList()
    }
}

enum class TimestampMode {
    Exif,
    ActivityStart,
    Now,
}

private const val DEFAULT_ACTIVITY_DURATION_MS = 90L * 60L * 1000L
private const val GALLERY_TIME_TOLERANCE_MS = 15L * 60L * 1000L
