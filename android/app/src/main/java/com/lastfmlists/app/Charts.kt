@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package com.lastfmlists.app

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lastfmlists.core.*
import kotlinx.coroutines.*
import java.time.LocalDate
import kotlin.math.ln

@Composable fun ChartRows(rows: List<ResultRow>,query: Query,onSelect: (ResultRow)->Unit,modifier: Modifier=Modifier) {
    var log by rememberSaveable { mutableStateOf(false) }; var vertical by rememberSaveable { mutableStateOf(false) }
    Column(modifier) {
        Row(Modifier.padding(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) { FilterChip(selected=log,onClick={log=!log},label={Text("Log scale")}); FilterChip(selected=vertical,onClick={vertical=!vertical},label={Text("Vertical")}) }
        val max=rows.maxOfOrNull { it.value.coerceAtLeast(0.0) }?.coerceAtLeast(1.0) ?: 1.0
        fun fraction(value: Double)=(if(log) ln(value.coerceAtLeast(0.0)+1)/ln(max+1) else value.coerceAtLeast(0.0)/max).toFloat().coerceIn(0f,1f)
        if(vertical) Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()).padding(16.dp),horizontalArrangement=Arrangement.spacedBy(10.dp),verticalAlignment=Alignment.Bottom) {
            rows.forEach { row -> Column(Modifier.width(100.dp).clickable {onSelect(row)},horizontalAlignment=Alignment.CenterHorizontally) {
                Text(metricText(row.value,query.sort),style=MaterialTheme.typography.labelSmall)
                Box(Modifier.height(220.dp).fillMaxWidth(),contentAlignment=Alignment.BottomCenter) { Box(Modifier.width(56.dp).fillMaxHeight(fraction(row.value).coerceAtLeast(0.005f)).clip(RoundedCornerShape(topStart=12.dp,topEnd=12.dp)).background(MaterialTheme.colorScheme.primary)) }
                Text(row.title,Modifier.heightIn(min=52.dp).padding(top=6.dp),maxLines=2,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.labelMedium)
            } }
        } else LazyColumn(Modifier.weight(1f),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            itemsIndexed(rows,key={_,r->r.key}) { index,row ->
                val width by animateFloatAsState(fraction(row.value),tween(350),label="Bar width")
                Column(Modifier.animateItem().fillMaxWidth().clickable {onSelect(row)}.semantics { contentDescription="Rank ${index+1}, ${row.title}, ${metricText(row.value,query.sort)}" }) {
                    Row(verticalAlignment=Alignment.CenterVertically) { Text(row.title,Modifier.weight(1f),style=MaterialTheme.typography.titleSmall,maxLines=1,overflow=TextOverflow.Ellipsis); Text(metricText(row.value,query.sort),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.primary) }
                    if(row.artist.isNotBlank()) Text(row.artist,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Box(Modifier.padding(top=5.dp).height(22.dp).fillMaxWidth().clip(RoundedCornerShape(7.dp)).background(MaterialTheme.colorScheme.surfaceContainer)) { Box(Modifier.fillMaxHeight().fillMaxWidth(width.coerceAtLeast(0.005f)).clip(RoundedCornerShape(7.dp)).background(MaterialTheme.colorScheme.primary)) }
                }
            }
        }
    }
}

