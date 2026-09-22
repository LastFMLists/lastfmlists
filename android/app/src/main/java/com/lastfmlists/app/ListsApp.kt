@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package com.lastfmlists.app

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.*
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage
import com.lastfmlists.core.*
import kotlinx.coroutines.*

@Composable fun ListsApp(vm: MainViewModel) {
    val status by vm.status.collectAsState()
    var filterSide by rememberSaveable { mutableStateOf<String?>(null) }
    var filterField by rememberSaveable {mutableStateOf<String?>(null)}
    val selected=vm.selectedEntity
    var history by rememberSaveable {mutableStateOf(false)}
    var export by rememberSaveable { mutableStateOf(false) }
    var listDisplay by rememberSaveable {mutableStateOf("List")}
    var showTotals by rememberSaveable {mutableStateOf(false)}
    val hasLibrary=vm.analytics?.history?.isNotEmpty()==true
    val snackbar=remember { SnackbarHostState() }
    val scope=rememberCoroutineScope()
    val wide=LocalConfiguration.current.screenWidthDp>=720
    val destinations=listOf("Lists" to Icons.AutoMirrored.Rounded.List,"Games" to Icons.Rounded.SportsEsports,"Library" to Icons.Rounded.LibraryMusic,"Settings" to Icons.Rounded.Settings)
    Scaffold(
        snackbarHost={ SnackbarHost(snackbar) },
        topBar={ if(hasLibrary && selected==null && !(vm.comparison && LocalConfiguration.current.screenHeightDp<500 && vm.tab==0)) CenterAlignedTopAppBar(title={ Text("lastfmlists",fontWeight=FontWeight.Bold,letterSpacing=(-0.6).sp) },navigationIcon={ Icon(Icons.Rounded.GraphicEq,null,Modifier.padding(start=20.dp),tint=MaterialTheme.colorScheme.primary) },actions={ IconButton(onClick={vm.sync()},enabled=vm.canSync && !status.running) { Icon(Icons.Rounded.Refresh,"Refresh library") } }) },
        bottomBar={ if(hasLibrary && selected==null && !wide && !WindowInsets.isImeVisible) NavigationBar { destinations.forEachIndexed { i,(title,icon) -> NavigationBarItem(selected=vm.tab==i,onClick={vm.tab=i;vm.selectedEntity=null},icon={Icon(icon,null)},label={Text(title)}) } } }
    ) { padding ->
        Row(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).imePadding()) {
        if(hasLibrary && wide) NavigationRail {
            destinations.forEachIndexed { i,(title,icon) -> NavigationRailItem(selected=vm.tab==i,onClick={vm.tab=i;vm.selectedEntity=null},icon={Icon(icon,null)},label={Text(title)}) }
        }
        Column(Modifier.weight(1f).fillMaxHeight()) {
            if(status.running) Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer).padding(horizontal=20.dp,vertical=8.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically) { Text(status.message,Modifier.weight(1f),style=MaterialTheme.typography.labelMedium); TextButton(onClick=vm::stopDownload) { Text("Pause") } }
                if(status.pages>0) LinearProgressIndicator(progress={status.page.toFloat()/status.pages},modifier=Modifier.fillMaxWidth()) else LinearProgressIndicator(Modifier.fillMaxWidth())
            }
            vm.error?.let { message -> Card(Modifier.padding(horizontal=16.dp,vertical=4.dp),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.errorContainer)) { Row(Modifier.padding(12.dp),verticalAlignment=Alignment.CenterVertically) { Text(message,Modifier.weight(1f),color=MaterialTheme.colorScheme.onErrorContainer); IconButton(onClick={vm.error=null}) { Icon(Icons.Rounded.Close,"Dismiss error") } } } }
            if(!hasLibrary) Welcome(vm,status)
            else if(selected!=null) EntityPage(selected!!,vm,{vm.selectedEntity=null}) { q -> vm.updateQuery(q);vm.compare(false);vm.tab=0;vm.selectedEntity=null }
            else when(vm.tab) {
                0 -> ListsScreen(vm,{side,field->filterSide=side;filterField=field},{vm.selectedEntity=it},{export=true},{history=true},listDisplay,{listDisplay=it},showTotals,{showTotals=it})
                1 -> Box(Modifier.fillMaxSize(),contentAlignment=Alignment.TopCenter) { Box(Modifier.widthIn(max=900.dp).fillMaxSize()) { GamesScreen(vm) } }
                2 -> Box(Modifier.fillMaxSize(),contentAlignment=Alignment.TopCenter) { Box(Modifier.widthIn(max=900.dp).fillMaxSize()) { LibraryScreen(vm,snackbar) } }
                else -> SettingsScreen(vm,snackbar)
            }
        }
        }
    }
    if(filterSide!=null) {
        val isRight=filterSide=="right"
        FixedPanel("Filters",{filterSide=null}) {
            FilterEditor(if(isRight) vm.right else vm.left,vm.hasDetails(),if(isRight) "Right list" else "Your list",filterField,listDisplay,{listDisplay=it},showTotals,{showTotals=it}) { q -> vm.updateQuery(q,isRight); filterSide=null;filterField=null }
        }
    }
    if(history) FixedPanel("List history",{history=false}) {HistoryPanel(vm) {history=false}}
    if(vm.supportPrompt && vm.tab==0 && selected==null && filterSide==null && !export && !history) {
        val context=LocalContext.current
        LaunchedEffect(Unit) {vm.supportShown()}
        Dialog(onDismissRequest={vm.dismissSupport()}) {Card(shape=RoundedCornerShape(28.dp)) {
            Column(Modifier.padding(24.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(14.dp)) {
                Surface(shape=RoundedCornerShape(22.dp),color=MaterialTheme.colorScheme.primaryContainer) {Icon(Icons.Rounded.Favorite,null,Modifier.padding(16.dp).size(32.dp),tint=MaterialTheme.colorScheme.primary)}
                Text("Enjoying lastfmlists?",style=MaterialTheme.typography.headlineSmall,textAlign=androidx.compose.ui.text.style.TextAlign.Center)
                Text("I build and maintain lastfmlists independently. If it has made your listening history more fun, a small tip helps me keep improving it. Every feature stays free.",style=MaterialTheme.typography.bodyMedium,textAlign=androidx.compose.ui.text.style.TextAlign.Center,color=MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick={vm.dismissSupport();context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://ko-fi.com/lastfmlists")))},modifier=Modifier.fillMaxWidth()) {Icon(Icons.Rounded.Favorite,null);Spacer(Modifier.width(8.dp));Text("Support on Ko-fi")}
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {TextButton(onClick={vm.dismissSupport(true)}) {Text("Don't show again")};TextButton(onClick={vm.dismissSupport()}) {Text("Maybe later")}}
            }
        }}
    }
    BackHandler(enabled=selected!=null) { vm.selectedEntity=null }
    if(export) FixedPanel("Export",{export=false}) {
        ExportPanel(vm) { message -> scope.launch { snackbar.showSnackbar(message) } }
    }
    BackHandler(enabled=hasLibrary && vm.tab!=0 && selected==null) { vm.tab=0 }
}

@Composable private fun Welcome(vm: MainViewModel,status: DownloadStatus) {
    var name by rememberSaveable { mutableStateOf(vm.displayName.takeUnless { vm.isDemo } ?: "") }
    val keyboard=LocalSoftwareKeyboardController.current
    val importer=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(vm::importCsv) }
    Box(Modifier.fillMaxSize(),contentAlignment=Alignment.Center) {
        Column(Modifier.widthIn(max=540.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(28.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
            Surface(shape=RoundedCornerShape(22.dp),color=MaterialTheme.colorScheme.primaryContainer) { Icon(Icons.Rounded.GraphicEq,null,Modifier.padding(18.dp).size(38.dp),tint=MaterialTheme.colorScheme.primary) }
            Text("lastfmlists",style=MaterialTheme.typography.displaySmall)
            Text("Download your Last.fm history to make lists and play games offline.",style=MaterialTheme.typography.bodyLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(value=name,onValueChange={name=it},label={Text("Last.fm username")},singleLine=true,modifier=Modifier.fillMaxWidth(),keyboardOptions=KeyboardOptions(imeAction=ImeAction.Go),keyboardActions=KeyboardActions(onGo={if(name.isNotBlank()) {keyboard?.hide();vm.chooseAccount(name)}}),shape=RoundedCornerShape(16.dp))
            Button(onClick={keyboard?.hide();vm.chooseAccount(name)},enabled=name.isNotBlank() && !status.running,modifier=Modifier.fillMaxWidth().heightIn(min=54.dp),shape=RoundedCornerShape(16.dp)) { Text(if(status.running) "Loading your library…" else "Load my music"); Spacer(Modifier.width(12.dp)); Icon(Icons.AutoMirrored.Rounded.ArrowForward,null) }
            Text("Your history is saved on this device. No password needed. Downloads pause when you leave, unless you enable background downloads.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(status.message.isNotBlank() && !status.running) Text(status.message,style=MaterialTheme.typography.bodyMedium)
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween) {
                TextButton(onClick=vm::demo,enabled=!status.running) { Text("Try a sample library") }
                TextButton(onClick={importer.launch(arrayOf("text/*","application/csv","application/octet-stream"))},enabled=!status.running) { Text("Import CSV") }
            }
            if(vm.accounts.isNotEmpty()) {
                Text("ON THIS DEVICE",style=MaterialTheme.typography.labelSmall)
                vm.accounts.forEach { a -> OutlinedButton(onClick={vm.chooseAccount(a.name,false)},modifier=Modifier.fillMaxWidth()) { Icon(Icons.Rounded.OfflinePin,null); Spacer(Modifier.width(8.dp)); Text(vm.accountLabel(a.name)) } }
            }
        }
    }
}

@Composable private fun ListsScreen(vm: MainViewModel,onFilter: (String,String?)->Unit,onSelect: (ResultRow)->Unit,onExport: ()->Unit,onHistory: ()->Unit,display: String,onDisplay: (String)->Unit,showTotals: Boolean,onShowTotals: (Boolean)->Unit) {
    LaunchedEffect(vm.username,vm.left,vm.right,vm.comparison,vm.calculating,vm.leftResult) {
        if(!vm.calculating) {vm.saveViewedList();delay(1500);vm.listViewed()}
    }
    val compact=LocalConfiguration.current.screenHeightDp<500
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxWidth().padding(horizontal=12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
            if(!compact) Row(verticalAlignment=Alignment.CenterVertically) {
                if(!vm.isDemo) {ProfileAvatar(vm.account?.avatar.orEmpty(),vm.displayName,44);Spacer(Modifier.width(12.dp))}
                Column(Modifier.weight(1f)) {
                    Text(if(vm.isDemo) "Sample library" else vm.displayName,style=MaterialTheme.typography.headlineMedium)
                    Text(if(vm.account?.pending==true) "Downloaded so far · resume to complete" else "${"%,d".format(vm.analytics?.history?.size ?: 0)} scrobbles · available offline",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick=onHistory) {Icon(Icons.Rounded.History,"List history")}
                FilledTonalIconButton(onClick=onExport) { Icon(Icons.Rounded.IosShare,"Export and share") }
            }
            if(!compact) Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceEvenly) {
                EntityType.entries.forEach { type -> FilterChip(selected=vm.left.type==type,onClick={vm.updateQuery(vm.left.copy(type=type))},label={Text(type.title)}) }
            }
            Row(verticalAlignment=Alignment.CenterVertically) {
                if(compact) Choice("List type",vm.left.type.name,EntityType.entries.map {it.name to it.title},{vm.updateQuery(vm.left.copy(type=EntityType.valueOf(it)))},Modifier.width(140.dp))
                if(compact) IconButton(onClick=onHistory) {Icon(Icons.Rounded.History,"List history")}
                if(compact) IconButton(onClick=onExport) {Icon(Icons.Rounded.IosShare,"Export and share")}
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    Button(onClick={vm.compare(!vm.comparison)},modifier=Modifier.weight(1f).heightIn(min=48.dp),contentPadding=PaddingValues(horizontal=8.dp),colors=if(vm.comparison) ButtonDefaults.buttonColors(containerColor=MaterialTheme.colorScheme.secondary,contentColor=MaterialTheme.colorScheme.onSecondary) else ButtonDefaults.buttonColors()) {Icon(Icons.Rounded.CompareArrows,if(vm.comparison) "Disable comparison" else "Compare two lists",Modifier.size(18.dp));Spacer(Modifier.width(4.dp));Text("Comparison",maxLines=1)}
                    Button(onClick={onFilter("left",null)},modifier=Modifier.weight(1f).heightIn(min=48.dp),contentPadding=PaddingValues(horizontal=8.dp)) {Icon(Icons.Rounded.FilterAlt,"Edit filters",Modifier.size(18.dp));Spacer(Modifier.width(4.dp));Text("Filters",maxLines=1)}
                    Button(onClick={vm.updateQuery(Query(type=vm.left.type))},modifier=Modifier.weight(1f).heightIn(min=48.dp),contentPadding=PaddingValues(horizontal=8.dp)) {Icon(Icons.Rounded.RestartAlt,"Reset filters",Modifier.size(18.dp));Spacer(Modifier.width(4.dp));Text("Reset",maxLines=1)}
                }
            }
            if(vm.calculating) LinearProgressIndicator(Modifier.fillMaxWidth())
        }
        if(vm.comparison && LocalConfiguration.current.screenWidthDp<600) Text("Rotate your phone for wider comparison columns.",Modifier.padding(horizontal=20.dp),style=MaterialTheme.typography.bodySmall)
        Box(Modifier.weight(1f)) {
            if(vm.comparison) CompositionLocalProvider(LocalComparison provides true) { Row(Modifier.fillMaxSize()) {
                ResultPane(vm.left,vm.leftResult,display,showTotals,onSelect,{onFilter("left",it)},Modifier.weight(1f),"Left list")
                VerticalDivider()
                ResultPane(vm.right,vm.rightResult,display,showTotals,onSelect,{onFilter("right",it)},Modifier.weight(1f),"Right list")
            } } else ResultPane(vm.left,vm.leftResult,display,showTotals,onSelect,{onFilter("left",it)},Modifier.fillMaxSize())
        }
    }
}

@Composable fun ResultPane(query: Query,result: Analysis,display: String,totals: Boolean,onSelect: (ResultRow)->Unit,onFilter: (String?)->Unit,modifier: Modifier=Modifier,title: String="") {
    var expanded by rememberSaveable(query) {mutableStateOf(false)}
    key(query,result) { Column(modifier) {
        val sortLabel=Catalog.sorts.firstOrNull {it.first==query.sort}?.second?.replace("X",query.x.toString()) ?: query.sort
        val active=query.filters.filterValues {it.isNotBlank()}.map {(id,value)->Triple(id,Catalog.fields.firstOrNull {it.id==id}?.label ?: id,value)}
        if(!expanded) Row(Modifier.fillMaxWidth().padding(horizontal=8.dp),verticalAlignment=Alignment.CenterVertically) {
            Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                AssistChip(onClick={onFilter("__display__")},label={Text("Rank by: $sortLabel")})
                active.forEach {(id,label,value)->AssistChip(onClick={onFilter(id)},label={Text("$label: $value",maxLines=1,overflow=TextOverflow.Ellipsis)})}
                if(query.equations.isNotBlank()) AssistChip(onClick={onFilter("__equations__")},label={Text("Equations")})
            }
            IconButton(onClick={expanded=true}) {Icon(Icons.Rounded.ExpandMore,"Show all active filters")}
        } else FlowRow(Modifier.padding(horizontal=12.dp),horizontalArrangement=Arrangement.spacedBy(6.dp),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            AssistChip(onClick={onFilter("__display__")},label={Text("Rank by: $sortLabel")})
            active.forEach {(id,label,value)->AssistChip(onClick={onFilter(id)},label={Text("$label: $value",maxLines=1,overflow=TextOverflow.Ellipsis)})}
            if(query.equations.isNotBlank()) AssistChip(onClick={onFilter("__equations__")},label={Text("Equations")})
            IconButton(onClick={expanded=false}) {Icon(Icons.Rounded.ExpandLess,"Collapse active filters")}
        }
        val resultSummary=if(query.type==EntityType.SCROBBLE) "${"%,d".format(result.matchingScrobbles)} scrobbles" else "${"%,d".format(result.totalEntities)} ${query.type.title.lowercase()} · ${"%,d".format(result.matchingScrobbles)} scrobbles"
        Text(resultSummary,Modifier.padding(horizontal=20.dp,vertical=2.dp),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        if(result.rows.isEmpty()) EmptyState("No matches yet","Try another filter, or download more of your listening history.")
        else if(display=="Chart") ChartRows(result.rows,query,onSelect,Modifier.weight(1f))
        else LazyColumn(Modifier.weight(1f).testTag("results-${title.ifBlank {"main"}}"),contentPadding=PaddingValues(horizontal=16.dp,vertical=10.dp),verticalArrangement=Arrangement.spacedBy(7.dp)) {
            itemsIndexed(result.rows,key={_,row->row.key}) { index,row -> MusicRow(index,row,query,totals,onSelect) }
        }
    }
}

} // Reset list and chart scroll state when the query changes.

@Composable fun MusicRow(index: Int,row: ResultRow,query: Query,totals: Boolean,onSelect: (ResultRow)->Unit) {
    Card(onClick={onSelect(row)},shape=RoundedCornerShape(16.dp),colors=CardDefaults.cardColors(containerColor=if(index%2==0) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.surfaceContainerLow)) {
        Row(Modifier.padding(12.dp).fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(10.dp)) {
            Text("${index+1}".padStart(2,'0'),Modifier.widthIn(min=24.dp),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
            if(LocalConfiguration.current.screenWidthDp>=600 || !LocalComparison.current) Artwork(row,42)
            Column(Modifier.weight(1f)) {
                Text(row.title,style=MaterialTheme.typography.titleMedium,maxLines=2,overflow=TextOverflow.Ellipsis)
                if(row.artist.isNotBlank()) Text(row.artist,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=1,overflow=TextOverflow.Ellipsis)
                if(totals) Text("Library #${row.fullRank} · ${row.fullCount} plays",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                row.extras.forEach { (key,value) -> Text("${EquationFields.label(key)}: $value",style=MaterialTheme.typography.labelSmall) }
            }
            Text(metricText(row.value,query.sort),style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable fun Artwork(row: ResultRow,size: Int=48) {
    Box(Modifier.size(size.dp).clip(RoundedCornerShape((size/4).dp)).background(MaterialTheme.colorScheme.primaryContainer),contentAlignment=Alignment.Center) {
        if(row.sample.image.isNotBlank()) AsyncImage(model=row.sample.image,contentDescription=null,contentScale=ContentScale.Crop,modifier=Modifier.fillMaxSize())
        else Icon(Icons.Rounded.MusicNote,null,Modifier.size((size/2).dp),tint=MaterialTheme.colorScheme.primary)
    }
}

@Composable fun ProfileAvatar(url: String,name: String,size: Int=52) {
    Box(Modifier.size(size.dp).clip(androidx.compose.foundation.shape.CircleShape).background(MaterialTheme.colorScheme.primaryContainer),contentAlignment=Alignment.Center) {
        if(url.isNotBlank()) AsyncImage(model=url,contentDescription="$name profile image",contentScale=ContentScale.Crop,modifier=Modifier.fillMaxSize())
        else Text(name.take(1).uppercase(),style=MaterialTheme.typography.titleLarge,color=MaterialTheme.colorScheme.primary)
    }
}

@Composable fun EmptyState(title: String,message: String) {
    Column(Modifier.fillMaxWidth().padding(32.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)) { Icon(Icons.Rounded.GraphicEq,null,Modifier.size(40.dp),tint=MaterialTheme.colorScheme.primary); Text(title,style=MaterialTheme.typography.titleLarge); Text(message,color=MaterialTheme.colorScheme.onSurfaceVariant) }
}

@Composable fun Choice(label: String,value: String,options: List<Pair<String,String>>,onChange: (String)->Unit,modifier: Modifier=Modifier) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier) {
        OutlinedButton(onClick={expanded=true},modifier=Modifier.fillMaxWidth().heightIn(min=52.dp),shape=RoundedCornerShape(12.dp)) { Column(Modifier.weight(1f)) { Text(label,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant); Text(options.firstOrNull { it.first==value }?.second ?: value,maxLines=2) }; Icon(Icons.Rounded.ExpandMore,null) }
        DropdownMenu(expanded=expanded,onDismissRequest={expanded=false},modifier=Modifier.heightIn(max=380.dp)) { options.forEach { (key,title) -> DropdownMenuItem(text={Text(title)},onClick={onChange(key);expanded=false}) } }
    }
}

@Composable private fun FilterEditor(query: Query,details: Boolean,title: String,initialField: String?,display: String,onDisplay: (String)->Unit,showTotals: Boolean,onShowTotals: (Boolean)->Unit,onApply: (Query)->Unit) {
    var draft by remember { mutableStateOf(query) }
    var equationValid by remember {mutableStateOf(true)}
    var resetVersion by remember {mutableIntStateOf(0)}
    val initialGroup=when(initialField) {"__equations__"->"Equations";null,"__display__"->"Display";else->Catalog.fields.firstOrNull {it.id==initialField}?.group ?: "Display"}
    var group by rememberSaveable(initialField) { mutableStateOf(initialGroup) }
    Column(Modifier.fillMaxSize()) {
        Text("List settings",Modifier.padding(horizontal=24.dp),style=MaterialTheme.typography.titleLarge)
        Text(title,Modifier.padding(horizontal=24.dp,vertical=4.dp),color=MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) { listOf("Display","Artist","Album","Track","Time","Equations").forEach { name -> FilterChip(selected=group==name,onClick={group=name},label={Text(name)}) } }
        Column(Modifier.weight(1f).verticalScroll(remember(group) { androidx.compose.foundation.ScrollState(0) }).padding(horizontal=24.dp,vertical=8.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
            if(group=="Display") {
                Choice("View",display,listOf("List" to "List","Chart" to "Chart"),onDisplay)
                SettingSwitch("Show full-library counts and ranks","Show each result’s position in the complete downloaded library.",showTotals,onShowTotals)
                Choice("List type",draft.type.name,EntityType.entries.map { it.name to it.title },{draft=draft.copy(type=EntityType.valueOf(it))})
                Choice("Rank by",draft.sort,Catalog.sorts.filter { details || it.first !in listOf("time-spent-listening","highest-listening-percentage") },{draft=draft.copy(sort=it)})
                IntegerField("X",draft.x) { draft=draft.copy(x=it.coerceAtLeast(1)) }
                IntegerField("List length · 0 shows all",draft.limit) { draft=draft.copy(limit=it) }
                IntegerField("Tracks per artist · 0 is unlimited",draft.maxPerArtist) { draft=draft.copy(maxPerArtist=it) }
                Text("Counts and ranks in filters refer to your whole downloaded library.",style=MaterialTheme.typography.bodySmall)
            } else if(group=="Equations") {
                key(resetVersion) { EquationEditor(draft.equations,{equationValid=it}) { draft=draft.copy(equations=it) } }
            } else {
                if(!details && group in listOf("Artist","Album","Track")) Text("Global stats, genres and duration unlock as you download details from Library.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.primary)
                Catalog.fields.filter { it.group==group }.forEach { field ->
                    val value=draft.filters[field.id] ?: ""
                    val focusRequester=remember(field.id,initialField) {FocusRequester()}
                    LaunchedEffect(field.id,initialField) {if(field.id==initialField) focusRequester.requestFocus()}
                    if(field.options.isNotEmpty()) Choice(field.label,value,field.options,{draft=draft.copy(filters=draft.filters+(field.id to it))})
                    else OutlinedTextField(value=value,onValueChange={draft=draft.copy(filters=draft.filters+(field.id to it))},label={Text(field.label)},placeholder={if(!field.id.endsWith("includes") && !field.id.endsWith("excludes")) Text(field.hint)},supportingText={if(value.isNotBlank() && (field.id.endsWith("includes") || field.id.endsWith("excludes"))) Text("Comma = OR; semicolon = AND") },enabled=!field.detailed || details,singleLine=true,modifier=Modifier.fillMaxWidth().focusRequester(focusRequester),shape=RoundedCornerShape(12.dp),keyboardOptions=KeyboardOptions(keyboardType=if(field.id.endsWith("-min") || field.id.endsWith("-max")) KeyboardType.Decimal else KeyboardType.Text))
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(20.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)) { OutlinedButton(onClick={draft=Query(type=draft.type);equationValid=true;resetVersion++},modifier=Modifier.weight(1f)) { Text("Reset") }; Button(onClick={onApply(draft)},enabled=equationValid,modifier=Modifier.weight(1f)) { Text("Apply filters") } }
    }
}

@Composable fun IntegerField(label: String,value: Int,onChange: (Int)->Unit) {
    var text by remember(value) { mutableStateOf(value.toString()) }
    OutlinedTextField(value=text,onValueChange={input -> text=input; input.toIntOrNull()?.takeIf { it>=0 }?.let(onChange)},label={Text(label)},modifier=Modifier.fillMaxWidth(),singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number),shape=RoundedCornerShape(12.dp))
}

@Composable private fun LibraryScreen(vm: MainViewModel,snackbar: SnackbarHostState) {
    val context=LocalContext.current; val scope=rememberCoroutineScope()
    var consent by rememberSaveable { mutableStateOf(false) }; var delete by rememberSaveable { mutableStateOf(false) }; var switch by rememberSaveable { mutableStateOf(false) }; var allDetails by rememberSaveable { mutableStateOf(false) }
    val permission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if(!granted) scope.launch { snackbar.showSnackbar("Download progress will remain available in the app.") } }
    val importer=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { it?.let(vm::importCsv) }
    val status by vm.status.collectAsState()
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        item { Text("Your library",style=MaterialTheme.typography.headlineMedium) }
        item { Card(colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.primaryContainer)) { Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment=Alignment.CenterVertically) {if(!vm.isDemo) {ProfileAvatar(vm.account?.avatar.orEmpty(),vm.displayName);Spacer(Modifier.width(12.dp))};Text(if(vm.isDemo) "Sample library" else vm.displayName,style=MaterialTheme.typography.titleLarge)}
            Text("${"%,d".format(vm.analytics?.history?.size ?: 0)} scrobbles saved on this device")
            if(vm.isDemo) Text("Illustrative listening history for exploring the app. This is not a real Last.fm account.",style=MaterialTheme.typography.bodySmall)
            else if(vm.isImported) Text("Imported snapshot. Import another CSV to update it, or open the original Last.fm username to download live history.",style=MaterialTheme.typography.bodySmall)
            else if(vm.account?.pending==true) Text("History is incomplete. Resume the download for complete rankings.")
            else Text("Lists and games work offline. Album art is available offline after it has been viewed.",style=MaterialTheme.typography.bodySmall)
            if(status.message.isNotBlank()) Text(status.message,style=MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) { Button(onClick=vm::sync,enabled=vm.canSync && !status.running) { Text(if(vm.account?.pending==true) "Resume download" else "Refresh") }; TextButton(onClick={switch=true},enabled=!status.running) { Text("Switch account") } }
        } } }
        item { Text("Music metadata",style=MaterialTheme.typography.titleMedium); Text("Download tags, durations and global statistics. Metadata-based lists unlock only after All details finishes; partial progress stays saved for the next attempt.",style=MaterialTheme.typography.bodySmall) }
        item { Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) { OutlinedButton(onClick={vm.details(false)},enabled=!vm.isDemo && !status.running,modifier=Modifier.weight(1f)) { Text("Load details") }; OutlinedButton(onClick={allDetails=true},enabled=!vm.isDemo && !status.running,modifier=Modifier.weight(1f)) { Text("All details") } } }
        item { HorizontalDivider() }
        item { Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) { OutlinedButton(onClick={importer.launch(arrayOf("text/*","application/csv","application/octet-stream"))},enabled=!status.running,modifier=Modifier.weight(1f)) { Text("Import CSV") }; OutlinedButton(onClick={scope.launch { runCatching { Exporter.csv(context,vm.username,vm.analytics?.history ?: emptyList()) }.onFailure { snackbar.showSnackbar(it.message ?: "Export failed") } }},modifier=Modifier.weight(1f)) { Text("Export history") } } }
        item { SupportCard(vm) }
        item { Text("Your data stays on this device. Last.fm receives requests for the username and music metadata you load; artwork is fetched from its image hosts. Ko-fi opens separately in your browser. No advertising or analytics SDKs.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant) }
        item { TextButton(onClick={delete=true},enabled=!status.running) { Icon(Icons.Rounded.DeleteOutline,null); Spacer(Modifier.width(8.dp)); Text("Remove this saved library") } }
        item { Text("lastfmlists · ${BuildConfig.VERSION_NAME}",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant) }
    }
    if(delete) AlertDialog(onDismissRequest={delete=false},title={Text("Remove saved library?")},text={Text("This removes ${vm.username}’s downloaded history and metadata from this device. Nothing on Last.fm is changed.")},confirmButton={TextButton(onClick={delete=false;vm.removeAccount()}) {Text("Remove")}},dismissButton={TextButton(onClick={delete=false}) {Text("Cancel")}})
    if(allDetails) AlertDialog(onDismissRequest={allDetails=false},title={Text("Download all metadata?")},text={Text("This may make thousands of Last.fm requests. Completed entries are saved; you can pause and resume. Keep the app open while downloading details.")},confirmButton={TextButton(onClick={allDetails=false;vm.details(true)}) {Text("Download")}},dismissButton={TextButton(onClick={allDetails=false}) {Text("Cancel")}})
    if(switch) {
        var name by rememberSaveable { mutableStateOf("") }
        AlertDialog(onDismissRequest={switch=false},title={Text("Open a library")},text={Column(verticalArrangement=Arrangement.spacedBy(8.dp)) { OutlinedTextField(name,{name=it},label={Text("Last.fm username")},singleLine=true); vm.accounts.forEach { a -> TextButton(onClick={switch=false;vm.chooseAccount(a.name,false)}) {Text(vm.accountLabel(a.name))} } }},confirmButton={TextButton(onClick={switch=false;vm.chooseAccount(name)},enabled=name.isNotBlank()) {Text("Load")}},dismissButton={TextButton(onClick={switch=false}) {Text("Cancel")}})
    }
}

@Composable fun SettingSwitch(title: String,description: String,value: Boolean,onChange: (Boolean)->Unit) { Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) { Column(Modifier.weight(1f)) { Text(title,style=MaterialTheme.typography.titleMedium); Text(description,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant) }; Switch(checked=value,onCheckedChange=onChange) } }

@Composable fun SupportCard(vm: MainViewModel) {
    val context=LocalContext.current
    Card(colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surfaceContainer)) { Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
        Icon(Icons.Rounded.FavoriteBorder,null,tint=MaterialTheme.colorScheme.primary)
        Text("Support lastfmlists",style=MaterialTheme.typography.titleMedium)
        Text("Thank you for using lastfmlists. I build it independently, and your support helps me keep working on it. Every donation is appreciated. All features stay free.",style=MaterialTheme.typography.bodyMedium)
        if(BuildConfig.DEBUG || BuildConfig.EXTERNAL_TIPS_ENABLED) Button(onClick={context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://ko-fi.com/lastfmlists")))}) { Text("Support on Ko-fi"); Spacer(Modifier.width(8.dp)); Icon(Icons.Rounded.OpenInNew,null,Modifier.size(16.dp)) }
    } }
}

@Composable private fun SettingsScreen(vm: MainViewModel,snackbar: SnackbarHostState) {
    var consent by rememberSaveable { mutableStateOf(false) }
    val scope=rememberCoroutineScope()
    val permission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if(!granted) scope.launch {snackbar.showSnackbar("Download progress is available in the app.")} }
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(24.dp),verticalArrangement=Arrangement.spacedBy(20.dp)) {
        item {Text("Settings",style=MaterialTheme.typography.headlineMedium)}
        item { SettingSwitch("Background downloads","Continue a requested history download when you leave the app. You can pause it at any time.",vm.background) { if(it) consent=true else vm.updateBackgroundConsent(false) } }
        if(vm.background) item { SettingSwitch("Wi-Fi only","Background downloads wait for an unmetered connection.",vm.wifiOnly,vm::setWifi) }
        item { Choice("Appearance",vm.theme,listOf("System","Light","Dark").map { it to it },vm::changeTheme) }

    }
    if(consent) AlertDialog(onDismissRequest={consent=false},title={Text("Allow background downloads?")},text={Text("When you request a download, lastfmlists can keep fetching and saving your Last.fm history after you leave the app. This uses battery and network data. Wi-Fi only is enabled initially. Android may pause downloads; saved pages will resume. You can turn this off or pause the notification at any time.")},confirmButton={TextButton(onClick={vm.updateBackgroundConsent(true);consent=false;if(Build.VERSION.SDK_INT>=33) permission.launch(Manifest.permission.POST_NOTIFICATIONS)}) {Text("Allow")}},dismissButton={TextButton(onClick={consent=false}) {Text("Keep foreground only")}})

}


