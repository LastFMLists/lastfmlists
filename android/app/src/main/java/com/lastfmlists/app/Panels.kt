package com.lastfmlists.app

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

val LocalComparison=staticCompositionLocalOf {false}

/** Fixed bounds avoid nested scroll handoff to a draggable bottom sheet. */
@Composable fun FixedPanel(title: String,onClose: ()->Unit,content: @Composable ()->Unit) {
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false)) {
        Surface(Modifier.fillMaxSize().systemBarsPadding().imePadding(),color=MaterialTheme.colorScheme.surface) {
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().padding(horizontal=16.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically) {
                    Text(title,Modifier.weight(1f),style=MaterialTheme.typography.titleLarge)
                    IconButton(onClick=onClose) {Icon(Icons.Rounded.Close,"Close $title")}
                }
                Box(Modifier.weight(1f).fillMaxWidth()) {content()}
            }
        }
    }
}
