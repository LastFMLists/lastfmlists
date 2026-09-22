@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package com.lastfmlists.app

import android.content.Context
import android.content.Intent
import android.content.ClipData
import android.app.PendingIntent
import android.graphics.drawable.Icon
import android.os.Build
import android.graphics.*
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.core.content.FileProvider
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil.imageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import com.lastfmlists.core.*
import kotlinx.coroutines.*
import java.io.File
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlin.math.ceil

object Exporter {
    private fun file(context: Context,extension: String,description: String="export"): File {
        val directory=File(context.cacheDir,"exports").apply {mkdirs()}
        directory.listFiles()?.filter {System.currentTimeMillis()-it.lastModified()>86400000}?.forEach {it.delete()}
        val safe=description.canonical().replace(Regex("[^a-z0-9]+"),"-").trim('-').take(42).ifBlank {"export"}
        val whenMade=LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd-HHmmss"))
        val base="lastfmlists-$safe-$whenMade";var suffix=1
        while(true) {val candidate=File(directory,base+(if(suffix==1) "" else "-$suffix")+".$extension");if(candidate.createNewFile()) return candidate;suffix++}
    }
    private suspend fun share(context: Context,file: File,mime: String) = withContext(Dispatchers.Main) {
        val uri=FileProvider.getUriForFile(context,"${context.packageName}.files",file)
        val intent=Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM,uri).putExtra(Intent.EXTRA_TITLE,file.name).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        intent.clipData=ClipData.newUri(context.contentResolver,file.name,uri)
        val chooser=Intent.createChooser(intent,"Share or save your export")
        if(Build.VERSION.SDK_INT>=34 && mime.startsWith("image/")) {
            val saveIntent=Intent(context,ExportSaveReceiver::class.java).setData(uri).putExtra("name",file.name).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            val pending=PendingIntent.getBroadcast(context,file.name.hashCode(),saveIntent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val action=android.service.chooser.ChooserAction.Builder(Icon.createWithResource(context,android.R.drawable.stat_sys_download),"Save to Downloads",pending).build()
            chooser.putExtra(Intent.EXTRA_CHOOSER_CUSTOM_ACTIONS,arrayOf(action))
        }
        context.startActivity(chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    suspend fun csv(context: Context,user: String,plays: List<Scrobble>) {
        val output=withContext(Dispatchers.IO) {file(context,"csv","$user-history").apply {writeText(Csv.write(user,plays))}}
        share(context,output,"text/csv")
    }
    private fun text(canvas: Canvas,text: String,x: Int,y: Int,width: Int,size: Float,color: Int,bold: Boolean=false,lines: Int=100): Int {
        val paint=TextPaint(Paint.ANTI_ALIAS_FLAG).apply {textSize=size;this.color=color;typeface=if(bold) Typeface.create("sans-serif",Typeface.BOLD) else Typeface.create("sans-serif",Typeface.NORMAL)}
        val layout=StaticLayout.Builder.obtain(text,0,text.length,paint,width).setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(false).setMaxLines(lines).setEllipsize(android.text.TextUtils.TruncateAt.END).build()
        canvas.save();canvas.translate(x.toFloat(),y.toFloat());layout.draw(canvas);canvas.restore();return layout.height
    }
    fun render(user: String,sets: List<Pair<Query,List<ResultRow>>>,chart: Boolean,dark: Boolean,includeFilters: Boolean,frame: String=""): Bitmap {
        require(sets.sumOf {it.second.size}<=500) {"For an image, set the list length to 500 or fewer. CSV export keeps the full history."}
        val bg=if(dark) Color.rgb(17,24,39) else Color.rgb(255,252,248)
        val fg=if(dark) Color.rgb(220,233,247) else Color.rgb(59,47,36)
        val accent=if(dark) Color.rgb(133,187,251) else Color.rgb(158,74,38)
        val columnWidth=720; val columns=sets.sumOf {maxOf(1,ceil(it.second.size/70.0).toInt())}; val width=columnWidth*columns
        val maxRows=sets.maxOfOrNull {minOf(70,it.second.size)} ?: 0
        val filterDescriptions=sets.joinToString("\n") { (q,_) -> listOfNotNull("${q.type.title} · ${Catalog.sorts.firstOrNull {it.first==q.sort}?.second ?: q.sort}",if(q.filters.values.any {it.isNotBlank()}) q.filters.filterValues {it.isNotBlank()}.map { (k,v) -> "${Catalog.fields.firstOrNull {it.id==k}?.label ?: k}: $v" }.joinToString(" · ") else null,q.equations.takeIf {it.isNotBlank()}).joinToString("\n") }
        val filterPaint=TextPaint(Paint.ANTI_ALIAS_FLAG).apply {textSize=20f;typeface=Typeface.create("sans-serif",Typeface.NORMAL)}
        val filterHeight=StaticLayout.Builder.obtain(filterDescriptions,0,filterDescriptions.length,filterPaint,width-64).setIncludePad(false).build().height
        val header=if(includeFilters) 150+filterHeight else 170
        val rowHeight=if(chart) 96 else 80
        val bitmap=Bitmap.createBitmap(width,header+maxRows*rowHeight+90,Bitmap.Config.ARGB_8888); val canvas=Canvas(bitmap);canvas.drawColor(bg)
        text(canvas,"lastfmlists",32,24,width-64,34f,accent,true)
        text(canvas,if(frame.isBlank()) "$user · your listening, in focus" else "$user · $frame",32,76,width-64,26f,fg,true)
        if(includeFilters) text(canvas,filterDescriptions,32,120,width-64,20f,fg)
        var column=0
        sets.forEach { (q,rows) ->
            val chunks=rows.chunked(70).ifEmpty {listOf(emptyList())}
            chunks.forEachIndexed {chunkIndex,chunk ->
                val x=column*columnWidth; val max=rows.maxOfOrNull {it.value}?.coerceAtLeast(1.0) ?: 1.0
                chunk.forEachIndexed {i,row ->
                    val y=header+i*rowHeight
                    text(canvas,"${chunkIndex*70+i+1}",x+24,y,46,20f,accent,true)
                    text(canvas,row.title,x+78,y,columnWidth-280,24f,fg,true,2)
                    if(row.artist.isNotBlank()) text(canvas,row.artist,x+78,y+38,columnWidth-280,18f,fg,false,1)
                    text(canvas,metricText(row.value,q.sort),x+columnWidth-185,y,170,22f,accent,true,2)
                    if(chart) canvas.drawRoundRect((x+78).toFloat(),(y+65).toFloat(),(x+78+(columnWidth-120)*(row.value/max).coerceIn(0.0,1.0)).toFloat(),(y+83).toFloat(),6f,6f,Paint(Paint.ANTI_ALIAS_FLAG).apply {color=accent})
                }
                column++
            }
        }
        text(canvas,"lastfmlists.com",32,bitmap.height-50,width-64,20f,accent)
        return bitmap
    }
    suspend fun png(context: Context,user: String,sets: List<Pair<Query,List<ResultRow>>>,chart: Boolean,dark: Boolean,filters: Boolean,shareOutput: Boolean=true): File {
        val description="${sets.firstOrNull()?.first?.type?.title ?: "list"}-${if(chart) "chart" else "list"}"
        val output=withContext(Dispatchers.Default) {val bitmap=render(user,sets,chart,dark,filters); try {file(context,"png",description).apply {outputStream().use {bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}}} finally {bitmap.recycle()} }
        if(shareOutput) share(context,output,"image/png")
        return output
    }
    suspend fun grid(context: Context,rows: List<ResultRow>,columns: Int,height: Int,duplicates: Boolean,skipMissing: Boolean,labels: Boolean,shareOutput: Boolean=true): File {
        require(columns in 1..10 && height in 1..10) {"Grid dimensions must be between 1 and 10"}
        val output=withContext(Dispatchers.IO) {
            val count=columns*height
            val candidates=if(duplicates) rows else rows.distinctBy {it.sample.artist.canonical()+"\u0000"+it.sample.album.canonical()}
            val bitmap=Bitmap.createBitmap(columns*400,height*400,Bitmap.Config.ARGB_8888);val canvas=Canvas(bitmap);canvas.drawColor(Color.rgb(30,41,59))
            try {
                var position=0
                for(row in candidates) {
                    if(position>=count) break
                    currentCoroutineContext().ensureActive()
                    val result=if(row.sample.image.isNotBlank()) context.imageLoader.execute(ImageRequest.Builder(context).data(row.sample.image).size(400).allowHardware(false).build()) as? SuccessResult else null
                    if(result==null && skipMissing) continue
                    val x=(position%columns)*400;val y=(position/columns)*400
                    result?.drawable?.let {drawable -> canvas.save();canvas.translate(x.toFloat(),y.toFloat());drawable.setBounds(0,0,400,400);drawable.draw(canvas);canvas.restore()}
                    if(labels || result==null) {canvas.drawRect(x.toFloat(),(y+306).toFloat(),(x+400).toFloat(),(y+400).toFloat(),Paint().apply {color=Color.argb(200,17,24,39)});text(canvas,row.sample.album.ifBlank {row.title},x+16,y+320,368,24f,Color.WHITE,true,1);text(canvas,row.sample.artist,x+16,y+358,368,19f,Color.WHITE,false,1)}
                    position++
                }
                require(position>0) {"No artwork available. Load album details, or turn off ‘Skip missing artwork’."}
                file(context,"png","album-grid-${columns}x$height").apply {outputStream().use {bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}}
            } finally {bitmap.recycle()}
        }
        if(shareOutput) share(context,output,"image/png")
        return output
    }
}

@Composable fun ExportPanel(vm: MainViewModel,onMessage: (String)->Unit) {
    val context=LocalContext.current;val scope=rememberCoroutineScope()
    var busy by remember {mutableStateOf(false)};var progress by remember {mutableStateOf("")};var task by remember {mutableStateOf<Job?>(null)}
    var dark by remember {mutableStateOf(vm.theme=="Dark")};var filters by remember {mutableStateOf(true)}
    var columns by remember {mutableIntStateOf(3)};var height by remember {mutableIntStateOf(3)};var duplicates by remember {mutableStateOf(false)};var missing by remember {mutableStateOf(true)};var labels by remember {mutableStateOf(true)}
    var notice by remember {mutableStateOf("")}
    val sets=listOf(vm.left to vm.leftResult.rows)+(if(vm.comparison) listOf(vm.right to vm.rightResult.rows) else emptyList())
    fun runExport(block: suspend ()->Unit) { task=scope.launch {
        busy=true;progress="Preparing export…"
        try {block();onMessage("Export ready")}
        catch(e: CancellationException) {onMessage("Export cancelled");throw e} catch(e: Exception) {onMessage(e.message ?: "Export failed")}
        finally {busy=false;progress=""}
    } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        Text("Export image",style=MaterialTheme.typography.headlineMedium)
        if(notice.isNotBlank()) Text(notice,color=MaterialTheme.colorScheme.primary)
        SettingSwitch("Dark export","Choose the image palette.",dark) {dark=it}
        SettingSwitch("Include active filters","Add the list settings to PNG exports.",filters) {filters=it}
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {Button(onClick={runExport {Exporter.png(context,vm.displayName,sets,false,dark,filters)}},enabled=!busy,modifier=Modifier.weight(1f)) {Text("List PNG")};Button(onClick={runExport {Exporter.png(context,vm.displayName,sets,true,dark,filters)}},enabled=!busy,modifier=Modifier.weight(1f)) {Text("Chart PNG")}}
        HorizontalDivider();Text("Album grid",style=MaterialTheme.typography.titleLarge)
        IntegerField("Columns (1–10)",columns) {columns=it.coerceIn(1,10)};IntegerField("Rows (1–10)",height) {height=it.coerceIn(1,10)}
        SettingSwitch("Allow duplicate covers","Keep repeat albums in the grid.",duplicates) {duplicates=it}
        SettingSwitch("Skip missing artwork","Use only covers that can be loaded.",missing) {missing=it}
        SettingSwitch("Show album and artist","Add labels over the covers.",labels) {labels=it}
        Button(onClick={runExport {Exporter.grid(context,vm.leftResult.rows,columns,height,duplicates,missing,labels)}},enabled=!busy,modifier=Modifier.fillMaxWidth()) {Text("Grid PNG")}
        if(busy) {LinearProgressIndicator(Modifier.fillMaxWidth());Text(progress);TextButton(onClick={task?.cancel()}) {Text("Cancel export")}}
        Spacer(Modifier.height(16.dp))
    }
}
