package com.example.gpxvideooverlay.data

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

class SampleRepository {
    var activities by mutableStateOf(
        listOf(
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
    )
}
