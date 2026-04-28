package com.example.gpxvideooverlay

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts.OpenDocument
import androidx.activity.result.contract.ActivityResultContracts.OpenMultipleDocuments
import androidx.activity.result.contract.ActivityResultContracts.RequestPermission
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import com.example.gpxvideooverlay.data.ActivityItem
import com.example.gpxvideooverlay.data.MediaItem
import com.example.gpxvideooverlay.data.SampleRepository
import com.example.gpxvideooverlay.data.TimestampMode
import com.example.gpxvideooverlay.ui.theme.GpxVideoOverlayTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween

private enum class OverlayScreen {
    Import,
    Media,
    Preview,
    Settings,
    Export,
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            GpxVideoOverlayTheme {
                OverlayApp()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OverlayApp() {
    val context = LocalContext.current
    val appContext = context.applicationContext
    val repository = remember(appContext) { SampleRepository(appContext) }

    var currentScreen by remember { mutableStateOf(OverlayScreen.Import) }
    var selectedActivityId by remember { mutableStateOf<String?>(null) }
    var statusMessage by remember { mutableStateOf("Bereit: Aktivitaet importieren") }
    var timestampMode by remember { mutableStateOf(TimestampMode.Exif) }

    var showReviewDialog by remember { mutableStateOf(false) }
    var reviewMedia by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    var excludedMediaIds by remember { mutableStateOf<Set<String>>(emptySet()) }

    var settingsOpen by remember { mutableStateOf(false) }
    var exportFormat by remember { mutableStateOf("MP4") }
    var videoDurationSec by remember { mutableFloatStateOf(45f) }
    var speedFactor by remember { mutableFloatStateOf(1f) }

    var previewReady by remember { mutableStateOf(false) }
    var previewImageCount by remember { mutableIntStateOf(0) }
    var previewMedia by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    var isProcessing by remember { mutableStateOf(false) }
    var processingMessage by remember { mutableStateOf("Lade...") }

    val coroutineScope = rememberCoroutineScope()

    var pendingGalleryAutoAssignActivityId by remember { mutableStateOf<String?>(null) }

    val activities = repository.activities
    val selectedActivity = activities.firstOrNull { it.id == selectedActivityId }
    val selectedMedia = selectedActivity?.let { repository.mediaForActivity(it.id) }.orEmpty()

    fun runGalleryAutoAssign(activityId: String) {
        val permission = galleryPermissionForDevice()
        val granted = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            isProcessing = true
            processingMessage = "Galerie wird durchsucht..."
            try {
                val (assigned, scanned) = repository.importGalleryPhotosForActivity(activityId)
                statusMessage = if (assigned > 0) {
                    "$assigned Bilder aus Galerie automatisch zugeordnet ($scanned geprueft)."
                } else {
                    "Keine passenden Galerie-Bilder im Aktivitaetszeitraum gefunden."
                }
            } finally {
                isProcessing = false
            }
        } else {
            pendingGalleryAutoAssignActivityId = activityId
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(RequestPermission()) { granted ->
        val targetActivityId = pendingGalleryAutoAssignActivityId
        if (granted && targetActivityId != null) {
            isProcessing = true
            processingMessage = "Galerie wird durchsucht..."
            try {
                val (assigned, scanned) = repository.importGalleryPhotosForActivity(targetActivityId)
                statusMessage = if (assigned > 0) {
                    "$assigned Bilder aus Galerie automatisch zugeordnet ($scanned geprueft)."
                } else {
                    "Galerie gelesen, aber keine passenden Bilder im Aktivitaetszeitraum gefunden."
                }
            } finally {
                isProcessing = false
            }
        } else if (!granted) {
            statusMessage = "Ohne Galerie-Berechtigung ist die automatische Bildsuche nicht moeglich."
        }
        pendingGalleryAutoAssignActivityId = null
    }

    val gpxPicker = rememberLauncherForActivityResult(OpenDocument()) { uri: Uri? ->
        if (uri == null) {
            statusMessage = "Kein GPX ausgewaehlt."
            return@rememberLauncherForActivityResult
        }

        persistReadPermission(appContext, uri)
        val name = queryDisplayName(appContext, uri) ?: "Importiert"
        isProcessing = true
        processingMessage = "GPX wird importiert..."
        var importedActivity: ActivityItem? = null
        try {
            importedActivity = try {
                repository.importGpxFromUri(uri, name)
            } catch (_: IllegalArgumentException) {
                statusMessage = "Die ausgewaehlte Datei ist kein gueltiges GPX."
                return@rememberLauncherForActivityResult
            }
            selectedActivityId = importedActivity?.id
            currentScreen = OverlayScreen.Media
            previewReady = false
            statusMessage = "Aktivitaet importiert: ${importedActivity?.title}. Suche automatisch passende Galerie-Bilder..."
        } finally {
            isProcessing = false
        }

        val imported = importedActivity ?: return@rememberLauncherForActivityResult
        val permission = galleryPermissionForDevice()
        val granted = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            runGalleryAutoAssign(imported.id)
        } else {
            pendingGalleryAutoAssignActivityId = imported.id
            permissionLauncher.launch(permission)
        }
    }

    val manualImagePicker = rememberLauncherForActivityResult(OpenMultipleDocuments()) { uris ->
        val activityId = selectedActivityId
        if (activityId == null) {
            statusMessage = "Bitte zuerst eine Aktivitaet importieren."
            return@rememberLauncherForActivityResult
        }

        uris.forEach { persistReadPermission(appContext, it) }
        isProcessing = true
        processingMessage = "Bilder werden importiert..."
        try {
            val imported = repository.importPhotosToActivity(activityId, uris, timestampMode)
            previewReady = false
            statusMessage = if (imported > 0) {
                "$imported Bilder manuell hinzugefuegt."
            } else {
                "Keine neuen Bilder hinzugefuegt."
            }
        } finally {
            isProcessing = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = {
                    if (currentScreen != OverlayScreen.Import) {
                        IconButton(onClick = {
                            currentScreen = when (currentScreen) {
                                OverlayScreen.Media -> OverlayScreen.Import
                                OverlayScreen.Preview -> OverlayScreen.Media
                                OverlayScreen.Settings -> OverlayScreen.Preview
                                OverlayScreen.Export -> OverlayScreen.Settings
                                OverlayScreen.Import -> OverlayScreen.Import
                            }
                        }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurueck")
                        }
                    }
                },
                title = { Text("GPX Video Overlay") },
                actions = {
                    when (currentScreen) {
                        OverlayScreen.Media -> {
                            TextButton(onClick = {
                                if (selectedActivity == null) {
                                    statusMessage = "Bitte zuerst eine Aktivitaet importieren."
                                } else if (selectedMedia.isEmpty()) {
                                    statusMessage = "Keine Bilder vorhanden. Bitte zuerst Bilder laden."
                                } else {
                                    currentScreen = OverlayScreen.Preview
                                }
                            }) {
                                Text("Preview")
                            }
                        }

                        OverlayScreen.Preview -> {
                            TextButton(onClick = { currentScreen = OverlayScreen.Settings }) {
                                Text("Weiter")
                            }
                        }

                        OverlayScreen.Settings -> {
                            TextButton(onClick = { currentScreen = OverlayScreen.Export }) {
                                Text("Export")
                            }
                        }

                        OverlayScreen.Export -> {
                            TextButton(onClick = {
                                if (!previewReady) {
                                    statusMessage = "Bitte zuerst die Video-Preview generieren."
                                } else {
                                    statusMessage = "Export gestartet (Platzhalter): $exportFormat, ${videoDurationSec.toInt()}s, ${"%.1f".format(speedFactor)}x."
                                }
                            }) {
                                Text("Export")
                            }
                        }

                        OverlayScreen.Import -> Unit
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF101826),
                    titleContentColor = Color.White,
                ),
            )
        },
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(Color(0xFF0B1220), Color(0xFF12263D), Color(0xFF080C14)),
                    ),
                )
                .padding(padding)
                .padding(16.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                StatusCard(statusMessage)

                when (currentScreen) {
                    OverlayScreen.Import -> {
                        ImportActivityStep(
                            onImport = {
                                gpxPicker.launch(arrayOf("application/gpx+xml", "application/octet-stream", "application/xml", "text/xml", "*/*"))
                            },
                        )
                    }

                    OverlayScreen.Media -> {
                        MediaStep(
                            selectedActivity = selectedActivity,
                            media = selectedMedia,
                            timestampMode = timestampMode,
                            onTimestampModeSelected = { timestampMode = it },
                            onImportMore = {
                                manualImagePicker.launch(arrayOf("image/*"))
                            },
                            onAutoAssignFromGallery = {
                                val activityId = selectedActivityId
                                if (activityId == null) {
                                    statusMessage = "Bitte zuerst eine Aktivitaet importieren."
                                } else {
                                    val permission = galleryPermissionForDevice()
                                    val granted = ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
                                    if (granted) {
                                        runGalleryAutoAssign(activityId)
                                    } else {
                                        pendingGalleryAutoAssignActivityId = activityId
                                        permissionLauncher.launch(permission)
                                    }
                                }
                            },
                        )
                    }

                    OverlayScreen.Preview -> {
                        PreviewStep(
                            selectedActivity = selectedActivity,
                            mediaCount = selectedMedia.size,
                            onGeneratePreview = {
                                if (selectedActivity == null) {
                                    statusMessage = "Bitte zuerst eine Aktivitaet importieren."
                                    return@PreviewStep
                                }
                                // If a preview was already created, don't reopen the review dialog automatically
                                if (previewReady) {
                                    statusMessage = "Preview bereits erstellt. Du kannst exportieren oder teilen."
                                    return@PreviewStep
                                }
                                if (selectedMedia.isEmpty()) {
                                    // Allow preview without images: create an empty preview
                                    previewMedia = emptyList()
                                    previewImageCount = 0
                                    previewReady = true
                                    statusMessage = "Preview erstellt (keine Bilder)."
                                    return@PreviewStep
                                }

                                // Existing flow when images are present
                                reviewMedia = selectedMedia
                                excludedMediaIds = emptySet()
                                showReviewDialog = true
                            },
                        )
                    }

                    OverlayScreen.Settings -> {
                        SettingsStep(
                            settingsOpen = settingsOpen,
                            exportFormat = exportFormat,
                            videoDurationSec = videoDurationSec,
                            speedFactor = speedFactor,
                            onToggleOpen = { settingsOpen = !settingsOpen },
                            onFormatChange = { exportFormat = it },
                            onDurationChange = { videoDurationSec = it },
                            onSpeedChange = { speedFactor = it },
                        )
                    }

                    OverlayScreen.Export -> {
                        ExportStep(
                            previewReady = previewReady,
                            previewImageCount = previewImageCount,
                            format = exportFormat,
                            durationSec = videoDurationSec.toInt(),
                            speedFactor = speedFactor,
                            onExport = {
                                if (!previewReady) {
                                    statusMessage = "Bitte zuerst die Video-Preview generieren."
                                } else {
                                    statusMessage = "Export gestartet (Platzhalter): $exportFormat, ${videoDurationSec.toInt()}s, ${"%.1f".format(speedFactor)}x."
                                }
                            },
                            onShare = {
                                if (!previewReady) {
                                    statusMessage = "Bitte zuerst die Video-Preview generieren."
                                } else {
                                    shareSummary(
                                        context = context,
                                        text = "GPX Video vorbereitet: $previewImageCount Bilder, $exportFormat, ${videoDurationSec.toInt()}s, ${"%.1f".format(speedFactor)}x",
                                    )
                                }
                            },
                        )
                    }
                }
            }
        }

        if (isProcessing) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0xAA050A12)),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    CircularProgressIndicator(color = Color(0xFFF5C84C))
                    Text(processingMessage, color = Color.White)
                }
            }
        }
    }

    if (showReviewDialog) {
        VideoReviewDialog(
            media = reviewMedia,
            excludedIds = excludedMediaIds,
            onToggle = { id ->
                excludedMediaIds = if (excludedMediaIds.contains(id)) {
                    excludedMediaIds - id
                } else {
                    excludedMediaIds + id
                }
            },
            onDismiss = { showReviewDialog = false },
            onConfirm = {
                // Show processing overlay while constructing the preview
                isProcessing = true
                processingMessage = "Preview wird erstellt..."
                coroutineScope.launch {
                    delay(300)
                    val chosen = reviewMedia.filterNot { excludedMediaIds.contains(it.id) }
                    previewMedia = chosen
                    previewImageCount = chosen.size
                    previewReady = true
                    statusMessage = "Preview erstellt mit $previewImageCount Bild(ern). Danach kannst du exportieren oder teilen."
                    showReviewDialog = false
                    isProcessing = false
                }
            },
        )
    }

    // If preview is ready, show an interactive preview player instead of the static step
    if (currentScreen == OverlayScreen.Preview && previewReady) {
        val startMs = selectedActivity?.startedAtMs ?: previewMedia.firstOrNull()?.capturedAtMs ?: System.currentTimeMillis()
        val endMs = selectedActivity?.endedAtMs ?: previewMedia.firstOrNull()?.capturedAtMs ?: (startMs + 1)
        PreviewPlayer(
            previewMedia = previewMedia,
            totalDurationSec = videoDurationSec,
            speedFactor = speedFactor,
            activityStartMs = startMs,
            activityEndMs = endMs,
        )
    }
}

@Composable
private fun StatusCard(status: String) {
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Status", color = Color.White, fontWeight = FontWeight.SemiBold)
            Text(status, color = Color(0xFFC7D8EA))
        }
    }
}

@Composable
private fun ImportActivityStep(
    onImport: () -> Unit,
) {
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("1. Aktivitaet importieren", color = Color.White, style = MaterialTheme.typography.headlineSmall)
            Text("Waehle eine GPX-Datei. Danach sucht die App automatisch passende Bilder aus der Galerie.", color = Color(0xFFB7C7D8))
            Button(onClick = onImport) {
                Icon(Icons.Filled.FolderOpen, contentDescription = null)
                Text(" GPX importieren")
            }
        }
    }
}

@Composable
private fun MediaStep(
    selectedActivity: ActivityItem?,
    media: List<MediaItem>,
    timestampMode: TimestampMode,
    onTimestampModeSelected: (TimestampMode) -> Unit,
    onImportMore: () -> Unit,
    onAutoAssignFromGallery: () -> Unit,
) {
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("2. Bilder", color = Color.White, style = MaterialTheme.typography.headlineSmall)
            Text(
                if (selectedActivity == null) "Importiere zuerst eine Aktivitaet." else "Bereits geladen: ${media.size}",
                color = Color(0xFFF5C84C),
            )

            if (media.isNotEmpty()) {
                media.take(6).forEach { item ->
                    Text("• ${item.displayName} (${item.capturedAtMs.toLocalDateTimeLabel()})", color = Color(0xFFB7C7D8))
                }
                if (media.size > 6) {
                    Text("+ ${media.size - 6} weitere", color = Color(0xFF7E95B4))
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = timestampMode == TimestampMode.Exif,
                    onClick = { onTimestampModeSelected(TimestampMode.Exif) },
                    label = { Text("Zeit: EXIF") },
                )
                FilterChip(
                    selected = timestampMode == TimestampMode.ActivityStart,
                    onClick = { onTimestampModeSelected(TimestampMode.ActivityStart) },
                    label = { Text("Zeit: Aktivitaetsstart") },
                )
                FilterChip(
                    selected = timestampMode == TimestampMode.Now,
                    onClick = { onTimestampModeSelected(TimestampMode.Now) },
                    label = { Text("Zeit: Jetzt") },
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onImportMore, enabled = selectedActivity != null) {
                    Icon(Icons.Filled.Image, contentDescription = null)
                    Text(" Weitere Bilder")
                }
                Button(onClick = onAutoAssignFromGallery, enabled = selectedActivity != null) {
                    Icon(Icons.Filled.Image, contentDescription = null)
                    Text(" Galerie scannen")
                }
            }
        }
    }
}

@Composable
private fun PreviewStep(
    selectedActivity: ActivityItem?,
    mediaCount: Int,
    onGeneratePreview: () -> Unit,
) {
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("3. Video-Preview", color = Color.White, style = MaterialTheme.typography.headlineSmall)
            Text(
                if (selectedActivity == null) "Keine Aktivitaet ausgewaehlt." else "${selectedActivity.title} · $mediaCount Bild(er)",
                color = Color(0xFFB7C7D8),
            )
            Text("Beim Klick oeffnet sich die Bildauswahl zur finalen Kontrolle.", color = Color(0xFF7E95B4))
            Button(onClick = onGeneratePreview, enabled = selectedActivity != null) {
                Icon(Icons.Filled.PlayArrow, contentDescription = null)
                Text(" Preview generieren")
            }
        }
    }
}

@Composable
private fun SettingsStep(
    settingsOpen: Boolean,
    exportFormat: String,
    videoDurationSec: Float,
    speedFactor: Float,
    onToggleOpen: () -> Unit,
    onFormatChange: (String) -> Unit,
    onDurationChange: (Float) -> Unit,
    onSpeedChange: (Float) -> Unit,
) {
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Filled.Settings, contentDescription = null, tint = Color(0xFFF5C84C))
                Text("4. Einstellungen", color = Color.White, style = MaterialTheme.typography.headlineSmall)
            }

            TextButton(onClick = onToggleOpen) {
                Text(if (settingsOpen) "Einstellungen ausblenden" else "Einstellungen oeffnen")
            }

            if (settingsOpen) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = exportFormat == "MP4", onClick = { onFormatChange("MP4") }, label = { Text("MP4") })
                    FilterChip(selected = exportFormat == "WebM", onClick = { onFormatChange("WebM") }, label = { Text("WebM") })
                }

                Text("Video-Laenge: ${videoDurationSec.toInt()} s", color = Color(0xFFB7C7D8))
                Slider(value = videoDurationSec, onValueChange = onDurationChange, valueRange = 10f..180f)

                Text("Geschwindigkeit: ${"%.1f".format(speedFactor)}x", color = Color(0xFFB7C7D8))
                Slider(value = speedFactor, onValueChange = onSpeedChange, valueRange = 0.5f..3f)
            }
        }
    }
}

@Composable
private fun ExportStep(
    previewReady: Boolean,
    previewImageCount: Int,
    format: String,
    durationSec: Int,
    speedFactor: Float,
    onExport: () -> Unit,
    onShare: () -> Unit,
) {
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("5. Export / Teilen", color = Color.White, style = MaterialTheme.typography.headlineSmall)
            if (previewReady) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Color(0xFF6EE7B7))
                    Text("Preview bereit: $previewImageCount Bilder, $format, ${durationSec}s, ${"%.1f".format(speedFactor)}x", color = Color(0xFFB7C7D8))
                }
            } else {
                Text("Bitte zuerst die Preview erstellen.", color = Color(0xFFB7C7D8))
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onExport, enabled = previewReady) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = null)
                    Text(" Export")
                }
                Button(onClick = onShare, enabled = previewReady) {
                    Icon(Icons.Filled.Share, contentDescription = null)
                    Text(" Teilen")
                }
            }
        }
    }
}

@Composable
private fun VideoReviewDialog(
    media: List<MediaItem>,
    excludedIds: Set<String>,
    onToggle: (String) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Bilder fuers Video pruefen") },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(media) { item ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        androidx.compose.material3.Checkbox(
                            checked = !excludedIds.contains(item.id),
                            onCheckedChange = { onToggle(item.id) },
                        )
                        AsyncImage(
                            model = item.uri,
                            contentDescription = item.displayName,
                            modifier = Modifier
                                .height(56.dp)
                                .fillMaxWidth(0.3f),
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(item.displayName, fontWeight = FontWeight.SemiBold)
                            Text(item.capturedAtMs.toLocalDateTimeLabel(), color = Color(0xFF66758A))
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text("Preview uebernehmen")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Abbrechen")
            }
        },
    )
}

private fun shareSummary(context: Context, text: String) {
    val shareIntent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, text)
    }
    context.startActivity(Intent.createChooser(shareIntent, "Teilen"))
}

// Simple export: package preview images into a ZIP in cache and return the file path.
private fun exportPreviewAsZip(context: Context, media: List<MediaItem>): String? {
    if (media.isEmpty()) return null
    try {
        val outFile = java.io.File(context.cacheDir, "gpx_preview_export_${System.currentTimeMillis()}.zip")
        java.util.zip.ZipOutputStream(java.io.BufferedOutputStream(java.io.FileOutputStream(outFile))).use { zos ->
            val buffer = ByteArray(4096)
            for (item in media) {
                val name = item.displayName ?: "image"
                val entry = java.util.zip.ZipEntry(name)
                zos.putNextEntry(entry)
                context.contentResolver.openInputStream(android.net.Uri.parse(item.uri))?.use { input ->
                    var read = input.read(buffer)
                    while (read >= 0) {
                        zos.write(buffer, 0, read)
                        read = input.read(buffer)
                    }
                }
                zos.closeEntry()
            }
        }
        return outFile.absolutePath
    } catch (e: Exception) {
        return null
    }
}

// Note: MP4 export via FFmpeg was removed due to dependency resolution issues.
// We keep ZIP export as a reliable fallback until FFmpeg is added correctly.

@Composable
private fun PreviewPlayer(
    previewMedia: List<MediaItem>,
    totalDurationSec: Float,
    speedFactor: Float,
    activityStartMs: Long,
    activityEndMs: Long,
) {
    val context = LocalContext.current
    val count = previewMedia.size
    // Build timeline events aligned to activity time range
    val startMs = activityStartMs
    val endMs = if (activityEndMs > startMs) activityEndMs else (startMs + 1)
    data class Event(val media: MediaItem, val timeSec: Float)
    val events = remember(previewMedia, startMs, endMs, totalDurationSec) {
        previewMedia.mapNotNull { m ->
            val pos = ((m.capturedAtMs - startMs).coerceIn(0L, endMs - startMs).toDouble() / (endMs - startMs).toDouble())
            val t = (pos * totalDurationSec).toFloat()
            Event(m, t)
        }.sortedBy { it.timeSec }
    }

    var playing by remember { mutableStateOf(false) }
    var currentTime by remember { mutableStateOf(0f) }
    var shownIds by remember { mutableStateOf(setOf<String>()) }
    var showingMedia by remember { mutableStateOf<MediaItem?>(null) }
    var showEndAt by remember { mutableStateOf(0f) }
    val showDuration = 2.5f

    val coroutineScope = rememberCoroutineScope()

    LaunchedEffect(playing) {
        while (playing) {
            delay(200)
            currentTime += 0.2f * speedFactor
            // trigger events
            events.forEach { ev ->
                if (!shownIds.contains(ev.media.id) && currentTime >= ev.timeSec) {
                    shownIds = shownIds + ev.media.id
                    showingMedia = ev.media
                    showEndAt = currentTime + showDuration
                }
            }
            if (showingMedia != null && currentTime >= showEndAt) {
                showingMedia = null
            }
            if (currentTime >= totalDurationSec) {
                playing = false
            }
        }
    }

    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("3. Route-Preview", color = Color.White, style = MaterialTheme.typography.headlineSmall)
            Text("Die Route ist die Hauptanzeige; Bilder werden kurz an ihrem Aufnahmezeitpunkt eingeblendet.", color = Color(0xFFB7C7D8))

            // Simple route timeline visualization (placeholder)
            androidx.compose.material3.Slider(value = (currentTime / (if (totalDurationSec > 0f) totalDurationSec else 1f)).coerceIn(0f, 1f), onValueChange = { frac ->
                currentTime = frac * totalDurationSec
            })

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = { playing = !playing }) { Text(if (playing) "Pause" else "Play") }
                Text("${(currentTime).toInt()}s / ${totalDurationSec.toInt()}s", color = Color(0xFFB7C7D8))
            }

            // Overlay area for showing media briefly
            Box(modifier = Modifier
                .height(240.dp)
                .fillMaxWidth(), contentAlignment = Alignment.Center) {
                // Placeholder route view: simple line
                androidx.compose.foundation.Canvas(modifier = Modifier.fillMaxWidth().height(80.dp)) {
                    val canvasSize = size
                    val y = canvasSize.height / 2f
                    drawLine(
                        color = Color(0xFF7E95B4),
                        start = androidx.compose.ui.geometry.Offset(0f, y),
                        end = androidx.compose.ui.geometry.Offset(canvasSize.width, y),
                        strokeWidth = 6f,
                    )
                    // draw markers for events
                    events.forEach { ev ->
                        val frac = if (totalDurationSec > 0f) (ev.timeSec / totalDurationSec) else 0f
                        val x = frac * canvasSize.width
                        drawCircle(color = Color(0xFFF5C84C), radius = 6f, center = androidx.compose.ui.geometry.Offset(x, y))
                    }
                }

                if (showingMedia != null) {
                    val scale by animateFloatAsState(targetValue = 1f, animationSpec = tween(350))
                    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF101826))) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(8.dp)) {
                            AsyncImage(model = showingMedia!!.uri, contentDescription = showingMedia!!.displayName, modifier = Modifier.height(160.dp).fillMaxWidth())
                            Text(showingMedia!!.displayName, color = Color.White)
                        }
                    }
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    coroutineScope.launch {
                        val path = exportPreviewAsZip(context, previewMedia)
                        if (path != null) shareSummary(context, "ZIP Export erstellt: $path") else shareSummary(context, "Export fehlgeschlagen.")
                    }
                }) { Text("Export als ZIP") }
            }
        }
    }
}

private fun galleryPermissionForDevice(): String {
    return if (Build.VERSION.SDK_INT >= 33) {
        Manifest.permission.READ_MEDIA_IMAGES
    } else {
        Manifest.permission.READ_EXTERNAL_STORAGE
    }
}

private fun persistReadPermission(context: Context, uri: Uri) {
    try {
        context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    } catch (_: SecurityException) {
        // URI may not support persistable permission; ignore.
    }
}

private fun queryDisplayName(context: Context, uri: Uri): String? {
    return try {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) cursor.getString(idx) else null
                } else {
                    null
                }
            }
    } catch (_: Exception) {
        null
    }
}

private fun Long.toLocalDateTimeLabel(): String {
    return java.text.SimpleDateFormat("dd.MM.yyyy HH:mm", java.util.Locale.GERMANY)
        .format(java.util.Date(this))
}
