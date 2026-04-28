package com.example.gpxvideooverlay.data

import androidx.compose.ui.graphics.Color

enum class ActivityType(val label: String, val tint: Color) {
    Ride("Ride", Color(0xFFF5C84C)),
    Run("Run", Color(0xFF6EE7B7)),
    Hike("Hike", Color(0xFF8B5CF6))
}

data class ActivityItem(
    val id: String,
    val title: String,
    val subtitle: String,
    val distanceLabel: String,
    val dateLabel: String,
    val startedAtMs: Long,
    val endedAtMs: Long,
    val type: ActivityType,
)

data class MediaItem(
    val id: String,
    val activityId: String,
    val uri: String,
    val displayName: String,
    val capturedAtMs: Long,
)

data class RoutePoint(
    val lat: Double,
    val lon: Double,
    val ele: Double?,
    val timeMs: Long?,
)
