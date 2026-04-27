package com.example.gpxvideooverlay

import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts.OpenDocument
import androidx.activity.result.contract.ActivityResultContracts.OpenMultipleDocuments
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Hiking
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.example.gpxvideooverlay.data.ActivityItem
import com.example.gpxvideooverlay.data.ActivityType
import com.example.gpxvideooverlay.data.MediaItem
import com.example.gpxvideooverlay.data.SampleRepository
import com.example.gpxvideooverlay.ui.theme.GpxVideoOverlayTheme

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

private enum class AppTab(val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Library("Library", Icons.Filled.Hiking),
    Import("Import", Icons.Filled.CloudDownload),
    Editor("Editor", Icons.Filled.Map),
    Export("Export", Icons.Filled.PlayArrow)
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun OverlayApp() {
    val context = LocalContext.current
    val appContext = context.applicationContext
    val repository = remember(appContext) { SampleRepository(appContext) }

    var activeTab by remember { mutableStateOf(AppTab.Library) }
    var selectedFilter by remember { mutableStateOf<ActivityType?>(null) }
    var selectedActivityId by remember { mutableStateOf<String?>(null) }
    var statusMessage by remember { mutableStateOf("Bereit") }

    var showReviewDialog by remember { mutableStateOf(false) }
    var reviewMedia by remember { mutableStateOf<List<MediaItem>>(emptyList()) }
    var excludedMediaIds by remember { mutableStateOf<Set<String>>(emptySet()) }

    val activities = repository.activities
    val selectedActivity = activities.firstOrNull { it.id == selectedActivityId } ?: activities.firstOrNull()

    if (selectedActivity != null && selectedActivityId == null) {
        selectedActivityId = selectedActivity.id
    }

    val gpxPicker = rememberLauncherForActivityResult(OpenDocument()) { uri: Uri? ->
        if (uri == null) {
            statusMessage = "Kein GPX ausgewaehlt."
            return@rememberLauncherForActivityResult
        }
        persistReadPermission(appContext, uri)
        val name = queryDisplayName(appContext, uri) ?: "Importiert"
        val imported = repository.importGpxFromUri(uri, name)
        selectedActivityId = imported.id
        statusMessage = "GPX importiert: ${imported.title}"
    }

    val imagePickerForSelected = rememberLauncherForActivityResult(OpenMultipleDocuments()) { uris ->
        val activityId = selectedActivityId
        if (activityId == null) {
            statusMessage = "Bitte zuerst eine Aktivitaet auswaehlen."
            return@rememberLauncherForActivityResult
        }

        uris.forEach { persistReadPermission(appContext, it) }
        val count = repository.importPhotosToActivity(activityId, uris)
        statusMessage = if (count > 0) {
            "$count Bilder zur Aktivitaet hinzugefuegt."
        } else {
            "Keine Bilder importiert."
        }
    }

    val autoImagePicker = rememberLauncherForActivityResult(OpenMultipleDocuments()) { uris ->
        uris.forEach { persistReadPermission(appContext, it) }
        val (assigned, skipped) = repository.autoAssignPhotos(uris)
        statusMessage = "Auto-Zuordnung: $assigned zugeordnet, $skipped uebersprungen."
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("GPX Video Overlay") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color(0xFF101826),
                    titleContentColor = Color.White
                )
            )
        },
        bottomBar = {
            NavigationBar(containerColor = Color(0xFF101826)) {
                AppTab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = activeTab == tab,
                        onClick = { activeTab = tab },
                        icon = { Icon(tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) }
                    )
                }
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(Color(0xFF0B1220), Color(0xFF12263D), Color(0xFF080C14))
                    )
                )
                .padding(padding)
                .padding(16.dp)
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                StatusCard(statusMessage, selectedActivity)

                when (activeTab) {
                    AppTab.Library -> LibraryScreen(
                        activities = activities,
                        selectedFilter = selectedFilter,
                        selectedActivityId = selectedActivityId,
                        onFilterSelected = { selectedFilter = it },
                        onActivitySelected = { selectedActivityId = it.id }
                    )

                    AppTab.Import -> ImportScreen(
                        selectedActivity = selectedActivity,
                        onConnectStrava = {
                            statusMessage = repository.connectStravaPlaceholder()
                        },
                        onImportFile = {
                            gpxPicker.launch(arrayOf("application/gpx+xml", "text/xml", "application/xml", "*/*"))
                        },
                        onImportPhotosForSelected = {
                            imagePickerForSelected.launch(arrayOf("image/*"))
                        },
                        onAutoAssignPhotos = {
                            autoImagePicker.launch(arrayOf("image/*"))
                        }
                    )

                    AppTab.Editor -> EditorScreen(
                        activity = selectedActivity,
                        media = selectedActivity?.let { repository.mediaForActivity(it.id) }.orEmpty()
                    )

                    AppTab.Export -> ExportScreen(
                        selectedActivity = selectedActivity,
                        onStartExport = {
                            if (selectedActivity == null) {
                                statusMessage = "Bitte zuerst eine Aktivitaet waehlen."
                                return@ExportScreen
                            }

                            val media = repository.mediaForActivity(selectedActivity.id)
                            if (media.isEmpty()) {
                                statusMessage = "Keine Bilder zur Aktivitaet vorhanden."
                                return@ExportScreen
                            }

                            reviewMedia = media
                            excludedMediaIds = emptySet()
                            showReviewDialog = true
                        }
                    )
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
                val finalCount = reviewMedia.size - excludedMediaIds.size
                statusMessage = "Video vorbereitet mit $finalCount Bild(ern)."
                showReviewDialog = false
            }
        )
    }
}

@Composable
private fun StatusCard(status: String, selectedActivity: ActivityItem?) {
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Status", color = Color.White, fontWeight = FontWeight.SemiBold)
            Text(status, color = Color(0xFFC7D8EA))
            Text(
                selectedActivity?.let { "Aktiv: ${it.title}" } ?: "Aktiv: Keine Aktivitaet",
                color = Color(0xFFF5C84C)
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LibraryScreen(
    activities: List<ActivityItem>,
    selectedFilter: ActivityType?,
    selectedActivityId: String?,
    onFilterSelected: (ActivityType?) -> Unit,
    onActivitySelected: (ActivityItem) -> Unit,
) {
    val filtered = remember(activities, selectedFilter) {
        if (selectedFilter == null) activities else activities.filter { it.type == selectedFilter }
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Aktivitaeten", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(selected = selectedFilter == null, onClick = { onFilterSelected(null) }, label = { Text("Alle") })
                    ActivityType.entries.forEach { type ->
                        FilterChip(
                            selected = selectedFilter == type,
                            onClick = { onFilterSelected(type) },
                            label = { Text(type.label) }
                        )
                    }
                }
            }
        }

        if (filtered.isEmpty()) {
            ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
                Text(
                    "Noch keine Aktivitaet importiert. Bitte in Import starten.",
                    color = Color(0xFFB7C7D8),
                    modifier = Modifier.padding(16.dp)
                )
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(filtered) { activity ->
                    ActivityCard(
                        activity = activity,
                        selected = selectedActivityId == activity.id,
                        onClick = { onActivitySelected(activity) }
                    )
                }
            }
        }
    }
}

@Composable
private fun ActivityCard(activity: ActivityItem, selected: Boolean, onClick: () -> Unit) {
    val cardColor = if (selected) Color(0xFF1C3048) else Color(0xFF132033)

    Card(
        colors = CardDefaults.cardColors(containerColor = cardColor),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                color = activity.type.tint.copy(alpha = 0.18f),
                shape = MaterialTheme.shapes.medium
            ) {
                Icon(
                    imageVector = Icons.Filled.Hiking,
                    contentDescription = null,
                    tint = activity.type.tint,
                    modifier = Modifier.padding(12.dp)
                )
            }

            Column(modifier = Modifier.weight(1f)) {
                Text(activity.title, color = Color.White, fontWeight = FontWeight.SemiBold)
                Text(activity.subtitle, color = Color(0xFFB7C7D8))
            }

            Column(horizontalAlignment = Alignment.End) {
                Text(activity.distanceLabel, color = Color(0xFFF5C84C), fontWeight = FontWeight.SemiBold)
                Text(activity.dateLabel, color = Color(0xFF7E95B4))
                if (selected) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Color(0xFF6EE7B7))
                }
            }
        }
    }
}

@Composable
private fun ImportScreen(
    selectedActivity: ActivityItem?,
    onConnectStrava: () -> Unit,
    onImportFile: () -> Unit,
    onImportPhotosForSelected: () -> Unit,
    onAutoAssignPhotos: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Import & Sync", color = Color.White, style = MaterialTheme.typography.headlineSmall)
                Text(
                    selectedActivity?.let { "Ziel-Aktivitaet: ${it.title}" } ?: "Keine Aktivitaet ausgewaehlt",
                    color = Color(0xFFF5C84C)
                )
                AssistChip(onClick = onConnectStrava, label = { Text("Strava verbinden") }, leadingIcon = { Icon(Icons.Filled.Sync, null) })
                AssistChip(onClick = onImportFile, label = { Text("GPX Datei importieren") }, leadingIcon = { Icon(Icons.Filled.FolderOpen, null) })
                AssistChip(onClick = onImportPhotosForSelected, label = { Text("Bilder zur Aktivitaet importieren") }, leadingIcon = { Icon(Icons.Filled.Image, null) })
                AssistChip(onClick = onAutoAssignPhotos, label = { Text("Bilder automatisch zuordnen") }, leadingIcon = { Icon(Icons.Filled.Image, null) })
            }
        }
    }
}

@Composable
private fun EditorScreen(activity: ActivityItem?, media: List<MediaItem>) {
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Editor", color = Color.White, style = MaterialTheme.typography.headlineSmall)
            Text(activity?.title ?: "Noch keine Aktivitaet ausgewaehlt.", color = Color(0xFFB7C7D8))
            Text("Zugeordnete Bilder: ${media.size}", color = Color(0xFFF5C84C))
            media.take(6).forEach { item ->
                Text("• ${item.displayName}", color = Color(0xFFB7C7D8))
            }
        }
    }
}

@Composable
private fun ExportScreen(
    selectedActivity: ActivityItem?,
    onStartExport: () -> Unit,
) {
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Export", color = Color.White, style = MaterialTheme.typography.headlineSmall)
            Text(
                selectedActivity?.let { "Aktivitaet: ${it.title}" } ?: "Bitte zuerst Aktivitaet waehlen.",
                color = Color(0xFFB7C7D8)
            )
            Button(onClick = onStartExport) {
                Icon(Icons.Filled.PlayArrow, contentDescription = null)
                Text(" Video vorbereiten")
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
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Checkbox(
                            checked = !excludedIds.contains(item.id),
                            onCheckedChange = { onToggle(item.id) }
                        )
                        AsyncImage(
                            model = item.uri,
                            contentDescription = item.displayName,
                            modifier = Modifier
                                .height(56.dp)
                                .fillMaxWidth(0.3f)
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
                Text("Video erstellen")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Abbrechen")
            }
        }
    )
}

private fun persistReadPermission(context: Context, uri: Uri) {
    try {
        context.contentResolver.takePersistableUriPermission(uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
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
