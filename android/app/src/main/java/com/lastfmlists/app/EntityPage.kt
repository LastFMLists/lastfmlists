package com.lastfmlists.app

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.lastfmlists.core.*
import kotlinx.coroutines.*
import java.time.Instant

@Composable fun EntityPage(input: ResultRow,vm: MainViewModel,onBack: ()->Unit,onOpen: (Query)->Unit) {
    val engine=vm.analytics ?: return
    val pages=remember(engine) {EntityPages(engine)}
    val context=LocalContext.current
    var info by remember(input.key,engine) {mutableStateOf<EntityOverview?>(null)}
    var artist by remember(input.key,engine) {mutableStateOf<RankedLink?>(null)}
    var length by remember(input.key,engine) {mutableStateOf<RankedLink?>(null)}
    var rankings by remember(input.key,engine) {mutableStateOf<Pair<List<RankedLink>,List<RankedLink>>?>(null)}
    var weekly by remember(input.key,engine) {mutableStateOf<List<RankedLink>>(emptyList())}
    var allMonths by remember(input.key,engine) {mutableStateOf<List<RankedLink>>(emptyList())}
    var error by remember {mutableStateOf<String?>(null)}
    var year by rememberSaveable(input.key) {mutableStateOf("")}
    var all by rememberSaveable(input.key) {mutableStateOf(false)}
    var months by remember(input.key) {mutableStateOf<List<RankedLink>>(emptyList())}
    var milestone by rememberSaveable(input.key) {mutableIntStateOf(pages.milestoneTarget)}
    var milestoneLinks by remember(input.key) {mutableStateOf<List<RankedLink>>(emptyList())}
    LaunchedEffect(pages,input) {
        try {
            val details=withContext(Dispatchers.Default) {val i=pages.overview(input);Triple(i,pages.artistRank(i.row),pages.nameLength(i.row))}
            info=details.first;artist=details.second;length=details.third
            if(year.isBlank()) year=info!!.years.last().label
            weekly=withContext(Dispatchers.Default) {pages.weeks(info!!.row)}
            allMonths=withContext(Dispatchers.Default) {info!!.years.flatMap {pages.months(info!!.row,it.label.toInt())}}
            rankings=withContext(Dispatchers.Default) {pages.rankings(info!!.row)}
        } catch(e: CancellationException) {throw e} catch(e: Exception) {error=e.message}
    }
    LaunchedEffect(year,info) {info?.let {i ->year.toIntOrNull()?.let {y ->months=withContext(Dispatchers.Default) {pages.months(i.row,y)}}}}
    LaunchedEffect(info,milestone) {info?.let {i ->milestoneLinks=withContext(Dispatchers.Default) {pages.milestones(i.row,milestone)}}}
    val highlights=remember(info,rankings,weekly,allMonths) {
        val candidates=buildList {
            addAll(info?.years.orEmpty().filter {it.rank?.let {rank->rank<=10}==true}.map {0 to it})
            addAll(allMonths.filter {it.rank?.let {rank->rank<=10}==true}.map {1 to it})
            addAll(weekly.filter {it.rank==1}.map {2 to it})
            addAll(rankings?.first.orEmpty().filter {it.rank?.let {rank->rank<=10}==true}.map {3 to it})
            addAll(rankings?.second.orEmpty().filter {it.query.sort !in listOf("first-n-scrobbles","fastest-n-scrobbles") && it.rank?.let {rank->rank<=10}==true}.map {4 to it})
        }
        candidates.sortedWith(compareBy<Pair<Int,RankedLink>> {it.second.rank}.thenByDescending {it.second.entries}.thenBy {it.first}).map {it.second}.take(3)
    }
    BackHandler(onBack=onBack)
    LazyColumn(Modifier.fillMaxSize().testTag("entity-page"),contentPadding=PaddingValues(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        item {TextButton(onClick=onBack) {Icon(Icons.AutoMirrored.Rounded.ArrowBack,null);Text("Back to list")}}
        item {Row(horizontalArrangement=Arrangement.spacedBy(12.dp)) {Artwork(input,48);Column {Text(input.title,style=MaterialTheme.typography.titleLarge);if(input.artist.isNotBlank()) Text(input.artist)}}}
        if(info==null && error==null) item {LinearProgressIndicator(Modifier.fillMaxWidth())}
        info?.let {i ->
            item {RankingLink(RankedLink("Library",i.row.fullCount,i.row.fullRank,Query(type=i.row.type,limit=0)),onOpen)}
            artist?.let {relative ->item {RankingLink(relative,onOpen)}}
            item {Text("First: ${Instant.ofEpochMilli(i.first).atZone(engine.zone).toLocalDate()} · Last: ${Instant.ofEpochMilli(i.last).atZone(engine.zone).toLocalDate()}",style=MaterialTheme.typography.bodySmall)}
            item {TextButton(onClick={
                val base="https://www.last.fm/music/"+Uri.encode(i.row.sample.artist)
                val url=when(i.row.type) {EntityType.TRACK -> "$base/_/${Uri.encode(i.row.sample.track)}";EntityType.ALBUM -> "$base/${Uri.encode(i.row.sample.album)}";else -> base}
                context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url)))
            }) {Text("Open on Last.fm")}}
            if(highlights.isNotEmpty()) item {Text("High placements",style=MaterialTheme.typography.titleMedium)}
            items(highlights) {RankingLink(it,onOpen,it.query.sort!="scrobbles")}
            item {EntityTimeline(engine,i.row,onOpen)}
            item {Button(onClick={all=!all},modifier=Modifier.fillMaxWidth()) {Text(if(all) "Show important lists only" else "Show all lists")}}
            if(all) {
                item {Text("${i.artistPlays} total plays of ${i.row.sample.artist}");Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick={onOpen(i.artistQuery)}) {Text("Artist’s tracks")}
                    OutlinedButton(onClick={onOpen(i.artistQuery.copy(type=EntityType.ALBUM))}) {Text("Artist’s albums")}
                }}
                item {Text("By year",style=MaterialTheme.typography.titleLarge)}
                items(i.years.filter {it.count>0}) {RankingLink(it,onOpen)}
                item {Choice("Detailed year",year,i.years.map {it.label to it.label},{year=it})}
                item {ExpandableRankingSection("By month",months.filter {it.count>0},onOpen,false,"No scrobbles in this year.")}
                item {ExpandableRankingSection("By week · Monday–Sunday",weekly.filter {it.count>0 && (it.query.filters.getValue("date-range-start").take(4)==year || it.query.filters.getValue("date-range-end").take(4)==year)},onOpen,false,"No scrobbles in any week shown for this year.")}
                item {
                    var expanded by rememberSaveable(i.row.key) {mutableStateOf(false)}
                    ExpandableHeader("Milestones · $milestone plays",expanded) {expanded=!expanded}
                    if(expanded) Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
                        IntegerField("Milestone plays",milestone) {milestone=it.coerceAtLeast(1)}
                        if(milestoneLinks.isEmpty()) Text("This ${i.row.type.title.lowercase().removeSuffix("s")} has not reached $milestone plays, so it has no milestone position.",style=MaterialTheme.typography.bodySmall)
                        milestoneLinks.forEach {RankingLink(it,onOpen,true)}
                        if(milestoneLinks.isEmpty()) {
                            TextButton(onClick={onOpen(Query(type=i.row.type,sort="first-n-scrobbles",x=milestone,limit=0))}) {Text("Open First to $milestone")}
                            TextButton(onClick={onOpen(Query(type=i.row.type,sort="fastest-n-scrobbles",x=milestone,limit=0))}) {Text("Open Fastest to $milestone")}
                        }
                    }
                }
                item {ExpandableRankingSection("Streak rankings · top 100",rankings?.first.orEmpty(),onOpen,true,"This ${i.row.type.title.lowercase().removeSuffix("s")} does not feature in the top 100 of any list measured in this section.")}
                item {ExpandableRankingSection("Other rankings · top 10",rankings?.second.orEmpty().filter {it.query.sort !in listOf("first-n-scrobbles","fastest-n-scrobbles")}+listOfNotNull(i.initial,length),onOpen,true,"This ${i.row.type.title.lowercase().removeSuffix("s")} does not feature in the top 10 of any list measured in this section.")}
            }
            item {Text("Based on downloaded history${if(vm.account?.pending==true) "; download is incomplete" else ""}. Tap a ranking to open its list.",style=MaterialTheme.typography.bodySmall)}
        }
        error?.let {item {Text(it,color=MaterialTheme.colorScheme.error)}}
    }
}

@Composable private fun ExpandableHeader(title: String,expanded: Boolean,onClick: ()->Unit) {
    TextButton(onClick=onClick,modifier=Modifier.fillMaxWidth()) {Text(title,Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);Icon(if(expanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,if(expanded) "Collapse" else "Expand")}
}

@Composable private fun ExpandableRankingSection(title: String,links: List<RankedLink>,onOpen: (Query)->Unit,metric: Boolean,emptyText: String) {
    var expanded by rememberSaveable(title) {mutableStateOf(false)}
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)) {
        ExpandableHeader(title,expanded) {expanded=!expanded}
        if(expanded) {
            if(links.isEmpty()) Text(emptyText,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            links.forEach {RankingLink(it,onOpen,metric)}
        }
    }
}

@Composable private fun RankingLink(link: RankedLink,onOpen: (Query)->Unit,metric: Boolean=false) {
    OutlinedCard(onClick={onOpen(link.query)},modifier=Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal=12.dp,vertical=8.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            Text(link.label,Modifier.weight(1f),style=MaterialTheme.typography.bodyMedium)
            Text(if(metric) metricText(link.value,link.query.sort) else "${link.count} plays",style=MaterialTheme.typography.bodyMedium)
            Text(link.rank?.let {"#$it"} ?: "—",color=MaterialTheme.colorScheme.primary)
        }
    }
}
