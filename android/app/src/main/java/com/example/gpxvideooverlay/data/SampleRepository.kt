package com.example.gpxvideooverlay.data

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

class SampleRepository(context: Context) {
    private val storageFile = File(context.filesDir, "activities.json")

    var activities by mutableStateOf(loadActivities())
        private set

    private fun loadActivities(): List<ActivityItem> {
        if (!storageFile.exists()) {
            val defaults = defaultActivities()
            saveActivities(defaults)
            return defaults
        }

        return try {
            val raw = storageFile.readText()
            if (raw.isBlank()) {
                defaultActivities()
            } else {
                val array = JSONArray(raw)
                buildList {
                    for (i in 0 until array.length()) {
                        val obj = array.getJSONObject(i)
                        add(obj.toActivityItem())
                    }
                }
            }
        } catch (_: Exception) {
            defaultActivities()
        }
    }

    private fun saveActivities(items: List<ActivityItem>) {
        val array = JSONArray()
        items.forEach { item ->
            array.put(item.toJson())
        }
        storageFile.writeText(array.toString(2))
    }

    private fun defaultActivities(): List<ActivityItem> = listOf(
        ActivityItem(
            id = "1",
            title = "München Süd Loop",
            subtitle = "GPX importiert · 438 m max",
            distanceLabel = "38.0 km",
            dateLabel = "26.04.2026",
            type = ActivityType.Ride,
        ),
        ActivityItem(
            id = "2",
            title = "Morning Run",
            subtitle = "Auto-Foto-Zuordnung aktiv",
            distanceLabel = "9.4 km",
            dateLabel = "25.04.2026",
            type = ActivityType.Run,
        ),
        ActivityItem(
            id = "3",
            title = "Alpine Hike",
            subtitle = "Höhenprofil und Foto-Spots",
            distanceLabel = "14.2 km",
            dateLabel = "20.04.2026",
            type = ActivityType.Hike,
        ),
    )

    private fun appendActivity(activity: ActivityItem) {
        activities = listOf(activity) + activities
        saveActivities(activities)
    }

    fun importDemoFileActivity() {
        appendActivity(
            ActivityItem(
                id = System.currentTimeMillis().toString(),
                title = "Importierte GPX-Datei",
                subtitle = "Lokaler Datei-Import gespeichert",
                distanceLabel = "21.7 km",
                dateLabel = "26.04.2026",
                type = ActivityType.Ride,
            )
        )
    }

    fun importDemoStravaActivity() {
        appendActivity(
            ActivityItem(
                id = System.currentTimeMillis().toString(),
                title = "Strava Sync",
                subtitle = "Demo-Synchronisierung erfolgreich",
                distanceLabel = "31.2 km",
                dateLabel = "26.04.2026",
                type = ActivityType.Run,
            )
        )
    }

    fun importDemoPhotoMatchedActivity() {
        appendActivity(
            ActivityItem(
                id = System.currentTimeMillis().toString(),
                title = "Foto-aktivität",
                subtitle = "Bilder anhand Zeitstempel zugeordnet",
                distanceLabel = "15.8 km",
                dateLabel = "26.04.2026",
                type = ActivityType.Hike,
            )
        )
    }
}

private fun ActivityItem.toJson(): JSONObject = JSONObject().apply {
    put("id", id)
    put("title", title)
    put("subtitle", subtitle)
    put("distanceLabel", distanceLabel)
    put("dateLabel", dateLabel)
    put("type", type.name)
}

private fun JSONObject.toActivityItem(): ActivityItem = ActivityItem(
    id = getString("id"),
    title = getString("title"),
    subtitle = getString("subtitle"),
    distanceLabel = getString("distanceLabel"),
    dateLabel = getString("dateLabel"),
    type = ActivityType.valueOf(getString("type")),
)
