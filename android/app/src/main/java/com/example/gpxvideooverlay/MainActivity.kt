package com.example.gpxvideooverlay

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Hiking
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import com.example.gpxvideooverlay.data.ActivityItem
import com.example.gpxvideooverlay.data.ActivityType
import com.example.gpxvideooverlay.data.SampleRepository
import com.example.gpxvideooverlay.ui.theme.GpxVideoOverlayTheme
import kotlinx.coroutines.launch

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
    var activeTab by remember { mutableStateOf(AppTab.Library) }
    var selectedFilter by remember { mutableStateOf<ActivityType?>(null) }
    val repository = remember { SampleRepository() }
    val activities by repository.activities

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
            when (activeTab) {
                AppTab.Library -> LibraryScreen(
                    activities = activities,
                    selectedFilter = selectedFilter,
                    onFilterSelected = { selectedFilter = it }
                )

                AppTab.Import -> ImportScreen()
                AppTab.Editor -> EditorScreen(activities.firstOrNull())
                AppTab.Export -> ExportScreen()
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LibraryScreen(
    activities: List<ActivityItem>,
    selectedFilter: ActivityType?,
    onFilterSelected: (ActivityType?) -> Unit,
) {
    val filtered = remember(activities, selectedFilter) {
        if (selectedFilter == null) activities else activities.filter { it.type == selectedFilter }
    }

    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Aktivitäten", color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
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

        LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(filtered) { activity ->
                ActivityCard(activity)
            }
        }
    }
}

@Composable
private fun ActivityCard(activity: ActivityItem) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF132033)),
        modifier = Modifier.fillMaxWidth()
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
                    imageVector = when (activity.type) {
                        ActivityType.Ride -> Icons.Filled.Hiking
                        ActivityType.Run -> Icons.Filled.Hiking
                        ActivityType.Hike -> Icons.Filled.Hiking
                    },
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
            }
        }
    }
}

@Composable
private fun ImportScreen() {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Import & Sync", color = Color.White, style = MaterialTheme.typography.headlineSmall)
                AssistChip(onClick = {}, label = { Text("Strava verbinden") }, leadingIcon = { Icon(Icons.Filled.Sync, null) })
                AssistChip(onClick = {}, label = { Text("Datei importieren") }, leadingIcon = { Icon(Icons.Filled.FolderOpen, null) })
                AssistChip(onClick = {}, label = { Text("Fotos automatisch zuordnen") }, leadingIcon = { Icon(Icons.Filled.Image, null) })
            }
        }
    }
}

@Composable
private fun EditorScreen(activity: ActivityItem?) {
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Editor", color = Color.White, style = MaterialTheme.typography.headlineSmall)
            Text(activity?.title ?: "Noch keine Aktivität ausgewählt.", color = Color(0xFFB7C7D8))
            Text("Hier kommen Kartenansicht, Höhenprofil, Marker und Foto-Spots hinein.", color = Color(0xFFB7C7D8))
        }
    }
}

@Composable
private fun ExportScreen() {
    ElevatedCard(colors = CardDefaults.elevatedCardColors(containerColor = Color(0xFF152235))) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Export", color = Color.White, style = MaterialTheme.typography.headlineSmall)
            Text("Preview, Rendering und spätere MP4/WebM-Ausgabe.", color = Color(0xFFB7C7D8))
            AssistChip(onClick = {}, label = { Text("Video erzeugen") }, leadingIcon = { Icon(Icons.Filled.PlayArrow, null) })
        }
    }
}
