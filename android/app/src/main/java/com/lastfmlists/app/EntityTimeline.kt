package com.lastfmlists.app

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalDensity
import android.graphics.Paint
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import com.lastfmlists.core.*
import kotlinx.coroutines.*
import java.time.LocalDate

@Composable fun EntityTimeline(engine: Analytics,row: ResultRow,onOpen: (Query)->Unit) {
    var range by rememberSaveable(row.key) {mutableStateOf("all")}
    var resolution by rememberSaveable(row.key) {mutableStateOf("month")}
    val entityPlays=remember(engine,row.key,row.type) {engine.history.filter {it.key(row.type)==row.key}}
    val first=engine.date(entityPlays.first()).toLocalDate();val last=engine.date(engine.history.last()).toLocalDate()
    var from by rememberSaveable(row.key) {mutableStateOf(first.toString())};var until by rememberSaveable(row.key) {mutableStateOf(last.toString())}
    val start=when(range) {"year"->last.minusYears(1).plusDays(1);"quarter"->last.minusMonths(3).plusDays(1);"custom"->runCatching {LocalDate.parse(from)}.getOrNull();else->first}
    val end=if(range=="custom") runCatching {LocalDate.parse(until)}.getOrNull() else last
    var data by remember {mutableStateOf<ListeningSeries?>(null)};var error by remember {mutableStateOf<String?>(null)};var selected by remember {mutableIntStateOf(-1)}
    val canDaily=start!=null && end!=null && ListeningTimeline.dailyAllowed(start,end)
    val axisWidth=with(LocalDensity.current) {36.dp.toPx()}
    fun listFor(bar: ListeningBar,resolution: String): Query {
        val filters=when(resolution) {
            "year" -> mapOf("year" to bar.start.year.toString())
            "month" -> mapOf("year" to bar.start.year.toString(),"month" to bar.start.monthValue.toString())
            else -> mapOf("date-range-start" to bar.start.toString(),"date-range-end" to bar.end.toString())
        }
        return Query(type=row.type,limit=0,filters=filters)
    }
    LaunchedEffect(engine,row,range,start,end,resolution) {
        selected=-1;data=null;error=null
        if(start==null || end==null) {error="Use YYYY-MM-DD dates";return@LaunchedEffect}
        try {data=withContext(Dispatchers.Default) {ListeningTimeline.series(engine,row,start,end,resolution)}}
        catch(e: CancellationException) {throw e} catch(e: Exception) {error=e.message}
    }
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text("Listening history",style=MaterialTheme.typography.titleMedium)
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            Choice("Timeframe",range,listOf("all" to "All time","year" to "Last year","quarter" to "Last 3 months","custom" to "Custom"),{range=it},Modifier.weight(1f))
            Choice("Resolution",if(resolution=="day" && !canDaily) "auto" else resolution,listOf("auto" to "Automatic")+(if(canDaily) listOf("day" to "Daily") else emptyList())+listOf("week" to "Weekly","month" to "Monthly","year" to "Yearly"),{resolution=it},Modifier.weight(1f))
        }
        if(range=="custom") Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(from,{from=it},label={Text("Start date")},singleLine=true,modifier=Modifier.weight(1f))
            OutlinedTextField(until,{until=it},label={Text("End date")},singleLine=true,modifier=Modifier.weight(1f))
        }
        if(!canDaily) Text("Daily resolution is available for ranges up to one year.",style=MaterialTheme.typography.labelSmall)
        data?.let {series ->
            val bars=series.bars;val peak=bars.maxOfOrNull {it.count} ?: 0
            val color=MaterialTheme.colorScheme.primary;val muted=MaterialTheme.colorScheme.outlineVariant
            Text("${bars.sumOf {it.count}} scrobbles · ${series.resolution.replaceFirstChar {it.uppercase()}} buckets · peak $peak",style=MaterialTheme.typography.labelSmall)
            Canvas(Modifier.fillMaxWidth().height(100.dp).semantics {contentDescription="Listening history chart: ${bars.size} ${series.resolution} periods, ${bars.sumOf {it.count}} scrobbles. Tap a nonempty bar to open its list."}.pointerInput(bars,peak,axisWidth) {detectTapGestures {p ->
                val plotWidth=size.width-axisWidth;val step=plotWidth/bars.size.coerceAtLeast(1);val raw=((p.x-axisWidth)/step).toInt()
                val bar=bars.getOrNull(raw);val height: Float=bar?.let {(size.height-1).toFloat()*it.count/peak.coerceAtLeast(1).toFloat()} ?: 0f
                if(bar!=null && bar.count>0 && p.x>=axisWidth+raw*step && p.x<=axisWidth+raw*step+step*0.82f && p.y>=size.height.toFloat()-height) {selected=raw;onOpen(listFor(bar,series.resolution))}
            }}) {
                val step=(size.width-axisWidth)/bars.size.coerceAtLeast(1)
                bars.forEachIndexed {i,bar ->val h=(size.height-1)*bar.count/peak.coerceAtLeast(1);drawRect(if(i==selected) muted else color,Offset(axisWidth+i*step,size.height-h),Size(step*0.82f,h))}
                drawLine(muted,Offset(axisWidth,size.height),Offset(size.width,size.height))
                val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply {this.color=muted.toArgb();textSize=11.dp.toPx();textAlign=Paint.Align.RIGHT}
                drawContext.canvas.nativeCanvas.apply {
                    drawText(peak.toString(),axisWidth-5.dp.toPx(),paint.textSize,paint)
                    drawText((peak/2).toString(),axisWidth-5.dp.toPx(),size.height/2+paint.textSize/2,paint)
                    drawText("0",axisWidth-5.dp.toPx(),size.height,paint)
                }
            }
            val nonempty=bars.indices.filter {bars[it].count>0}
            Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
                IconButton(onClick={selected=nonempty.lastOrNull {it<selected} ?: nonempty.lastOrNull() ?: -1},enabled=nonempty.isNotEmpty()) {Icon(Icons.Rounded.KeyboardArrowLeft,"Previous nonempty period")}
                bars.getOrNull(selected)?.let {bar ->Text("${bar.start} – ${bar.end}: ${bar.count} scrobbles",Modifier.weight(1f),style=MaterialTheme.typography.bodySmall);TextButton(onClick={onOpen(listFor(bar,series.resolution))}) {Text("Open list")}} ?: Text("$start – $end",Modifier.weight(1f),style=MaterialTheme.typography.bodySmall,textAlign=androidx.compose.ui.text.style.TextAlign.Center)
                IconButton(onClick={selected=nonempty.firstOrNull {it>selected} ?: nonempty.firstOrNull() ?: -1},enabled=nonempty.isNotEmpty()) {Icon(Icons.Rounded.KeyboardArrowRight,"Next nonempty period")}
            }
            Unit
        } ?: if(error==null) LinearProgressIndicator(Modifier.fillMaxWidth()) else Text(error!!,color=MaterialTheme.colorScheme.error)
    }
}


