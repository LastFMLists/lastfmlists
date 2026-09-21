package com.lastfmlists.app

import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.provider.MediaStore
import android.widget.Toast
import androidx.annotation.RequiresApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@RequiresApi(29)
class ExportSaveReceiver: BroadcastReceiver() {
    override fun onReceive(context: Context,intent: Intent) {
        val source=intent.data ?: return
        val requested=intent.getStringExtra("name") ?: "lastfmlists-export.png"
        val pending=goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val result=runCatching {
                val values=ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME,requested)
                    put(MediaStore.MediaColumns.MIME_TYPE,"image/png")
                    put(MediaStore.MediaColumns.RELATIVE_PATH,"Download/lastfmlists")
                }
                val destination=context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values) ?: error("Could not create the download")
                context.contentResolver.openInputStream(source)!!.use {input ->context.contentResolver.openOutputStream(destination)!!.use {output ->input.copyTo(output)}}
            }
            CoroutineScope(Dispatchers.Main).launch {Toast.makeText(context,if(result.isSuccess) "Saved to Downloads/lastfmlists" else "Could not save image",Toast.LENGTH_LONG).show();pending.finish()}
        }
    }
}
