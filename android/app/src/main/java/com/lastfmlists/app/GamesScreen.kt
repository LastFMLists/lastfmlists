@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package com.lastfmlists.app

import android.os.SystemClock
import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lastfmlists.core.*
import kotlinx.coroutines.*

@Composable fun GamesScreen(vm: MainViewModel) {
    val g=vm.game; val scope=rememberCoroutineScope(); val haptic=LocalHapticFeedback.current
    var celebrate by remember {mutableStateOf(false)}
    LaunchedEffect(g.celebration) {if(g.celebration>0) {celebrate=true;delay(900);celebrate=false}}
    fun newRound(mode: String,reset: Boolean=false) {
        if(g.busy) return
        if(reset) {g.streak=0;g.best=vm.savedRecord("$mode.${g.type.name}")}
        g.busy=true; g.feedback=null; g.lost=false; g.revealed=false; g.found=emptySet();g.answer=""
        scope.launch {
            try {
                when(mode) {
                    "Higher or Lower" -> { g.pair=withContext(Dispatchers.Default) {vm.games?.pair(g.type,g.streak)} ?: emptyList(); if(g.pair.size<2) g.feedback="This library needs at least two items with multiple plays." }
                    "Fill the List" -> { g.puzzle=withContext(Dispatchers.Default) {vm.games?.fill(g.types,g.categories)}; if(g.puzzle==null) g.feedback="No eligible top 10 yet. Try more categories or download more history. Each answer needs at least five plays."; g.deadline=if(g.timeLimit>0) SystemClock.elapsedRealtime()+g.timeLimit*1000L else 0 }
                    else -> {
                        g.puzzle=withContext(Dispatchers.Default) {vm.games?.ordering(g.type,g.streak)}
                        val answers=g.puzzle?.answers ?: emptyList()
                        val shuffled=answers.shuffled()
                        g.ordered=if(shuffled==answers && answers.size>1) shuffled.drop(1)+shuffled.first() else shuffled
                        if(g.puzzle==null) g.feedback="This library needs more familiar items with different values for a fair round."
                    }
                }
                g.mode=mode
            } catch(e: CancellationException) {throw e} catch(e: Exception) {g.feedback=e.message} finally {g.busy=false}
        }
    }
    fun guess(text: String,enter: Boolean=false) {
        g.answer=text
        if(g.revealed) return
        val candidates=g.puzzle?.answers?.filter { it.key !in g.found && Games.matches(text,it.title,enter) } ?: return
        if(candidates.size==1 || (!enter && candidates.isNotEmpty())) {
            g.found=g.found+candidates.map {it.key}; g.answer="";haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            g.celebration++
            g.best=vm.record("Fill the List",g.found.size)
            if(g.found.size==g.puzzle?.answers?.size) {g.revealed=true;g.feedback="All answers found!"}
        }
    }
    BackHandler(enabled=g.mode.isNotEmpty()) {g.mode=""}
    if(g.mode=="Fill the List options") {
        Column(Modifier.fillMaxSize()) {
            Row(verticalAlignment=Alignment.CenterVertically) {IconButton(onClick={g.mode=""}) {Icon(Icons.AutoMirrored.Rounded.ArrowBack,"All games")};Text("Fill the List",style=MaterialTheme.typography.titleLarge)}
            LazyColumn(Modifier.weight(1f),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                item {Text("Choose which lists to guess. Each round hides ten answers from your listening history.")}
                item {Text("Answer types",style=MaterialTheme.typography.titleMedium);Text("Select at least one.",style=MaterialTheme.typography.bodySmall)}

            item { FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) { listOf(EntityType.ARTIST,EntityType.ALBUM,EntityType.TRACK).forEach {type -> FilterChip(selected=type in g.types,onClick={g.types=if(type in g.types) g.types-type else g.types+type},label={Text(type.title)}) } } }
            item { Text("List categories",style=MaterialTheme.typography.titleMedium);Text("Select the kinds of lists you want to play.",style=MaterialTheme.typography.bodySmall);FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) { Games.categories.forEach {category -> FilterChip(selected=category in g.categories,onClick={g.categories=if(category in g.categories) g.categories-category else g.categories+category},label={Text(category)}) } } }
            item { SettingSwitch("Hard mode","Hide the artist on album and track answers.",g.hard) {g.hard=it} }
            item { Choice("Time limit",g.timeLimit.toString(),listOf("0" to "No timer","60" to "1 minute","180" to "3 minutes","300" to "5 minutes"),{g.timeLimit=it.toInt()}) }
            }
            Button(onClick={newRound("Fill the List",true)},enabled=g.types.isNotEmpty() && g.categories.isNotEmpty() && !g.busy,modifier=Modifier.fillMaxWidth().padding(20.dp)) {Text(if(g.busy) "Preparing list…" else "Start game")}
        }
        return
    }
    Box(Modifier.fillMaxSize()) {Column(Modifier.fillMaxSize()) {
        if(g.mode.isNotEmpty()) Row(Modifier.padding(horizontal=12.dp),verticalAlignment=Alignment.CenterVertically) { IconButton(onClick={g.mode=""}) {Icon(Icons.AutoMirrored.Rounded.ArrowBack,"All games")};Text(g.mode,Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);if(g.mode=="Fill the List") TextButton(onClick={g.mode="Fill the List options"}) {Text("Options")} }
        if(g.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        if(g.mode.isEmpty()) LazyColumn(contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
            item { Text("Games",style=MaterialTheme.typography.headlineMedium);Spacer(Modifier.height(8.dp));Text("Play using your saved listening history.",color=MaterialTheme.colorScheme.onSurfaceVariant) }
            item { Choice("Higher or Lower / Ordering",g.type.name,EntityType.entries.filter {it!=EntityType.SCROBBLE}.map {it.name to it.title},{g.type=EntityType.valueOf(it)}) }
            item { GameCard("Higher or Lower","Choose the artist, album or track you have played more.",Icons.Rounded.SwapVert) {newRound("Higher or Lower",true)} }
            item { GameCard("Put Them In Order","Arrange items by the displayed ranking.",Icons.Rounded.DragHandle) {newRound("Put Them In Order",true)} }
            item { GameCard("Fill the List","Name the ten items that match the list.",Icons.Rounded.EditNote) {g.mode="Fill the List options"} }
        } else {
            if(g.mode!="Fill the List") Row(Modifier.fillMaxWidth().padding(horizontal=24.dp,vertical=8.dp),horizontalArrangement=Arrangement.SpaceBetween) {Text("STREAK  ${g.streak}",style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.primary);Text("BEST  ${g.best}",style=MaterialTheme.typography.labelLarge)}
            g.feedback?.takeUnless {it in listOf("Correct!","All answers found!") }?.let { Text(it,Modifier.padding(horizontal=24.dp,vertical=8.dp),style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.primary) }
            when(g.mode) {
                "Higher or Lower" -> {
                    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                        Text("Which have you scrobbled more?",style=MaterialTheme.typography.titleMedium)
                        g.pair.forEach {row -> Card(onClick={
                            if(g.feedback==null) {
                                val correct=row.count==g.pair.maxOf {it.count}
                                g.lost=!correct
                                if(correct) {g.streak++;g.best=vm.record("Higher or Lower.${g.type.name}",g.streak);g.feedback="Correct!";g.celebration++} else g.feedback="Streak over. You reached ${g.streak}."
                                haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            }
                        },enabled=g.feedback==null,colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surfaceContainer),shape=RoundedCornerShape(24.dp)) {
                            Row(Modifier.fillMaxWidth().padding(24.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(16.dp)) {
                                Artwork(row,64);Column(Modifier.weight(1f)) {Text(row.title,style=MaterialTheme.typography.titleLarge);if(row.artist.isNotBlank()) Text(row.artist,color=MaterialTheme.colorScheme.onSurfaceVariant);if(g.feedback!=null) Text("${row.count} scrobbles",style=MaterialTheme.typography.headlineMedium,color=MaterialTheme.colorScheme.primary)}
                            }
                        } }
                        if(g.feedback!=null) Button(onClick={newRound(g.mode,g.lost)},modifier=Modifier.fillMaxWidth()) {Text(if(g.lost) "Play again" else "Next round")}
                    }
                }
                "Put Them In Order" -> {
                    Text(g.puzzle?.prompt ?: "",Modifier.padding(horizontal=24.dp,vertical=8.dp))
                    Text("Hold a row, then drag it to its new position. You can also use the arrows.",Modifier.padding(horizontal=24.dp),style=MaterialTheme.typography.bodySmall)
                    OrderBoard(g,Modifier.weight(1f))
                    Button(onClick={if(g.revealed) newRound(g.mode,g.lost) else {
                        val correct=g.ordered.map {it.key}==g.puzzle?.answers?.map {it.key}
                        g.revealed=true;g.lost=!correct
                        if(correct) {g.streak++;g.best=vm.record("Put Them In Order.${g.type.name}",g.streak);g.feedback="Correct!";g.celebration++} else {g.feedback="Here’s the right order. Your streak: ${g.streak}.";g.ordered=g.puzzle?.answers ?: emptyList()}
                    }},enabled=g.ordered.isNotEmpty(),modifier=Modifier.padding(20.dp).fillMaxWidth()) {Text(if(g.revealed) (if(g.lost) "Play again" else "Next round") else "Check order")}
                }
                else -> {
                    var seconds by remember {mutableLongStateOf(0)}
                    LaunchedEffect(g.deadline,g.revealed) { while(g.deadline>0 && !g.revealed) {seconds=((g.deadline-SystemClock.elapsedRealtime())/1000).coerceAtLeast(0);if(seconds==0L) {g.revealed=true;g.feedback="Time’s up. ${g.found.size} of 10 found."};delay(250)} }
                    Text(g.puzzle?.prompt ?: "",Modifier.padding(horizontal=24.dp,vertical=8.dp),style=MaterialTheme.typography.titleMedium)
                    Row(Modifier.fillMaxWidth().padding(horizontal=24.dp),horizontalArrangement=Arrangement.SpaceBetween) {Text("${g.found.size} / ${g.puzzle?.answers?.size ?: 10}",color=MaterialTheme.colorScheme.primary);if(g.deadline>0) Text("${seconds/60}:${(seconds%60).toString().padStart(2,'0')}")}
                    OutlinedTextField(value=g.answer,onValueChange={guess(it)},enabled=!g.revealed && g.puzzle!=null,label={Text("Name an answer")},modifier=Modifier.fillMaxWidth().padding(horizontal=20.dp,vertical=8.dp),singleLine=true,keyboardOptions=KeyboardOptions(imeAction=ImeAction.Done),keyboardActions=KeyboardActions(onDone={guess(g.answer,true)}))
                    LazyColumn(Modifier.weight(1f),contentPadding=PaddingValues(horizontal=20.dp),verticalArrangement=Arrangement.spacedBy(7.dp)) {
                        itemsIndexed(g.puzzle?.answers ?: emptyList()) {i,row -> val visible=g.revealed || row.key in g.found
                            Surface(shape=RoundedCornerShape(12.dp),color=MaterialTheme.colorScheme.surfaceContainer) {Row(Modifier.fillMaxWidth().padding(14.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)) {Text("${i+1}",color=MaterialTheme.colorScheme.primary);Column(Modifier.weight(1f)) {Text(if(visible) row.title else "• • • • •",style=MaterialTheme.typography.titleMedium);if((!g.hard || visible) && row.artist.isNotBlank()) Text(row.artist,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};if(visible) Text(metricText(row.value,g.puzzle?.query?.sort ?: "scrobbles"),style=MaterialTheme.typography.labelMedium)}}
                        }
                    }
                    Row(Modifier.padding(20.dp),horizontalArrangement=Arrangement.spacedBy(12.dp)) {OutlinedButton(onClick={g.revealed=true;g.feedback="${g.found.size} of 10 found. Here’s the full list."},enabled=!g.revealed && g.puzzle!=null,modifier=Modifier.weight(1f)) {Text("Reveal")};Button(onClick={g.mode="Fill the List options"},modifier=Modifier.weight(1f)) {Text("New list")}}
                }
            }
        }
    }
        AnimatedVisibility(visible=celebrate,modifier=Modifier.align(Alignment.Center),enter=fadeIn()+scaleIn(initialScale=0.7f),exit=fadeOut()+scaleOut(targetScale=1.15f)) {
            Surface(shape=RoundedCornerShape(28.dp),color=Color(0xFF1B7F3A),shadowElevation=12.dp) {
                Row(Modifier.padding(horizontal=28.dp,vertical=20.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Rounded.CheckCircle,null,tint=Color.White,modifier=Modifier.size(38.dp));Text(if(g.feedback=="All answers found!") "All answers found!" else "Correct!",color=Color.White,style=MaterialTheme.typography.headlineSmall,fontWeight=androidx.compose.ui.text.font.FontWeight.Bold)
                }
            }
        }
    }
}

@Composable private fun GameCard(title: String,description: String,icon: androidx.compose.ui.graphics.vector.ImageVector,onClick: ()->Unit) {
    Card(onClick=onClick,colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surfaceContainer),shape=RoundedCornerShape(24.dp)) { Column(Modifier.fillMaxWidth().padding(22.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {Icon(icon,null,tint=MaterialTheme.colorScheme.primary);Text(title,style=MaterialTheme.typography.titleLarge);Text(description,color=MaterialTheme.colorScheme.onSurfaceVariant)} }
}
