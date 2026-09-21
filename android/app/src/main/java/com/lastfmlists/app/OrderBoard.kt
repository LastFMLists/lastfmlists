package com.lastfmlists.app

import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.platform.ViewConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import com.lastfmlists.core.metricText
import kotlinx.coroutines.delay

@Composable fun OrderBoard(g: GameSession,modifier: Modifier=Modifier) {
    val state=rememberLazyListState();val haptic=LocalHapticFeedback.current
    var dragging by remember {mutableStateOf<String?>(null)}
    var pointer by remember {mutableFloatStateOf(0f)}
    var center by remember {mutableFloatStateOf(0f)}
    val normalViewConfiguration=LocalViewConfiguration.current
    val quickHold=remember(normalViewConfiguration) {object: ViewConfiguration by normalViewConfiguration {override val longPressTimeoutMillis=220L}}
    val compact=g.ordered.size>3
    fun move(index: Int,to: Int) {if(index!=to && index in g.ordered.indices && to in g.ordered.indices) {val rows=g.ordered.toMutableList();rows.add(to,rows.removeAt(index));g.ordered=rows;haptic.performHapticFeedback(HapticFeedbackType.LongPress)}}
    fun reorder() {
        val from=g.ordered.indexOfFirst {it.key==dragging};if(from<0) return
        val target=state.layoutInfo.visibleItemsInfo.firstOrNull {it.index!=from && center>=it.offset && center<=it.offset+it.size}
        if(target!=null && ((target.index>from && center>target.offset+target.size/2) || (target.index<from && center<target.offset+target.size/2))) move(from,target.index)
    }
    LaunchedEffect(dragging) {while(dragging!=null) {
        val layout=state.layoutInfo;val edge=80f
        val scroll=when {pointer<layout.viewportStartOffset+edge -> -14f;pointer>layout.viewportEndOffset-edge -> 14f;else -> 0f}
        if(scroll!=0f) {state.scrollBy(scroll);reorder()};delay(16)
    }}
    CompositionLocalProvider(LocalViewConfiguration provides quickHold) {LazyColumn(state=state,userScrollEnabled=dragging==null,modifier=modifier.testTag("order-board").semantics {stateDescription=if(dragging==null) "Ready to reorder" else "Dragging"}.pointerInput(g.revealed,g.puzzle) {
        if(!g.revealed) detectDragGesturesAfterLongPress(
            onDragStart={p ->val y=p.y+state.layoutInfo.viewportStartOffset;state.layoutInfo.visibleItemsInfo.firstOrNull {y>=it.offset && y<=it.offset+it.size}?.let {item ->dragging=g.ordered[item.index].key;pointer=y;center=item.offset+item.size/2f;haptic.performHapticFeedback(HapticFeedbackType.LongPress)}},
            onDragEnd={dragging=null},onDragCancel={dragging=null}
        ) {change,amount ->if(dragging!=null) {change.consume();pointer+=amount.y;center+=amount.y;reorder()}}
    },contentPadding=PaddingValues(horizontal=20.dp,vertical=if(compact) 4.dp else 16.dp),verticalArrangement=Arrangement.spacedBy(if(compact) 4.dp else 10.dp)) {
        itemsIndexed(g.ordered,key={_,row->row.key}) {i,row ->
            val active=dragging==row.key
            val item=state.layoutInfo.visibleItemsInfo.firstOrNull {it.key==row.key}
            val shift=if(active && item!=null) center-item.offset-item.size/2f else 0f
            Card(Modifier.fillMaxWidth().zIndex(if(active) 1f else 0f).graphicsLayer {translationY=shift;shadowElevation=if(active) 12f else 0f},colors=CardDefaults.cardColors(containerColor=if(active) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer)) {
                Row(Modifier.padding(horizontal=if(compact) 8.dp else 12.dp,vertical=if(compact) 3.dp else 10.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
                    Icon(Icons.Rounded.DragHandle,"Hold to drag ${row.title}",Modifier.size(if(compact) 22.dp else 24.dp));Spacer(Modifier.width(if(compact) 6.dp else 10.dp))
                    Column(Modifier.weight(1f)) {Text(row.title,style=if(compact) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.titleMedium,maxLines=1);if(row.artist.isNotBlank()) Text(row.artist,style=MaterialTheme.typography.labelSmall,maxLines=1);if(g.revealed) Text(metricText(row.value,g.puzzle?.query?.sort ?: "scrobbles"),style=MaterialTheme.typography.labelSmall)}
                    Row {IconButton(onClick={move(i,i-1)},enabled=!g.revealed && i>0,modifier=Modifier.size(40.dp)) {Icon(Icons.Rounded.KeyboardArrowUp,"Move ${row.title} up")};IconButton(onClick={move(i,i+1)},enabled=!g.revealed && i<g.ordered.lastIndex,modifier=Modifier.size(40.dp)) {Icon(Icons.Rounded.KeyboardArrowDown,"Move ${row.title} down")}}
                }
            }
        }
    }}
}




