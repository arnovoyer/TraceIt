package com.example.gpxvideooverlay.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColors = darkColorScheme(
    primary = Color(0xFFF5C84C),
    secondary = Color(0xFF6EE7B7),
    tertiary = Color(0xFF8B5CF6),
    background = Color(0xFF0B1220),
    surface = Color(0xFF132033),
    onPrimary = Color(0xFF101826),
    onSecondary = Color(0xFF101826),
    onTertiary = Color.White,
    onBackground = Color.White,
    onSurface = Color.White,
)

@Composable
fun GpxVideoOverlayTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColors,
        typography = MaterialTheme.typography,
        content = content,
    )
}
