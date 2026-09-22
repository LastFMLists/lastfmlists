package com.lastfmlists.app

import android.app.Application
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import com.lastfmlists.core.*

class ListsApplication: Application() {
    val store by lazy { LibraryStore(this) }
    val prefs by lazy { getSharedPreferences("preferences",MODE_PRIVATE) }
    val sync by lazy { SyncRepository(this) }
}
data class DownloadStatus(val running: Boolean=false,val message: String="",val page: Int=0,val pages: Int=0,val account: String="")
class SyncRepository(private val app: ListsApplication) {
    val status=MutableStateFlow(DownloadStatus())
    val revision=MutableStateFlow(0L)
    private val operation=Mutex()
    private val api by lazy { LastFm(app.assets.open("lastfm-key.txt").bufferedReader().use { it.readText().trim() }) }
    suspend fun sync(name: String,onProgress: suspend (DownloadStatus)->Unit = {}) = operation.withLock {
        status.value=DownloadStatus(true,"Connecting to Last.fm…",account=name)
        try {
            withContext(Dispatchers.IO) {
                val avatar=try {api.profile(name)} catch(e: CancellationException) {throw e} catch(_: Exception) {""}
                app.store.ensure(name,avatar)
                val snapshot=app.store.begin(name)
                var page=snapshot.nextPage; var total=snapshot.totalPages.coerceAtLeast(1)
                while(page<=total) {
                    currentCoroutineContext().ensureActive()
                    val result=api.page(snapshot,page)
                    total=result.totalPages
                    app.store.savePage(name,page,result.plays,total)
                    val progress=DownloadStatus(true,"Saved page $page of $total",page,total,name)
                    status.value=progress; onProgress(progress)
                    if(page==1 || page%20==0) revision.value++
                    page++
                }
                app.store.finish(name)
            }
            status.value=DownloadStatus(message="Library saved. Ready offline.",account=name)
        } catch(e: CancellationException) { status.value=DownloadStatus(message="Download paused. Saved pages will resume next time.",account=name); throw e }
        catch(e: Exception) { status.value=DownloadStatus(message=e.message ?: "Download failed. Saved data is still available.",account=name); throw e }
        finally { revision.value++ }
    }
    suspend fun details(name: String,all: Boolean) = operation.withLock {
        status.value=DownloadStatus(true,"Preparing metadata…",account=name)
        try {
            withContext(Dispatchers.IO) {
                if(all) {app.store.startFullDetails(name);revision.value++}
                val history=app.store.history(name); val saved=app.store.metadata(name)
                val items=listOf(EntityType.ARTIST,EntityType.ALBUM,EntityType.TRACK).flatMap { type ->
                    val groups=history.groupBy { it.key(type) }.values.sortedByDescending { it.size }
                    val limit=when(type) {EntityType.ARTIST -> 250;EntityType.ALBUM -> 500;else -> 1000}
                    (if(all) groups else groups.take(limit)).map { type to it.first() }
                }.filter { (type,s) -> (type to s.key(type)) !in saved && (type!=EntityType.ALBUM || s.album.isNotBlank()) }
                var unavailable=0
                items.forEachIndexed { i,(type,s) ->
                    currentCoroutineContext().ensureActive()
                    try { app.store.saveMetadata(name,type,s.key(type),api.detail(type,s)) }
                    catch(e: LastFmUnavailable) { unavailable++ }
                    status.value=DownloadStatus(true,"Details ${i+1}/${items.size} · $unavailable unavailable",i+1,items.size,name)
                }
                if(all) app.store.finishFullDetails(name)
                status.value=DownloadStatus(message="Details saved · $unavailable entries unavailable on Last.fm",account=name)
            }
        } catch(e: CancellationException) { status.value=DownloadStatus(message="Metadata paused; completed entries are saved.",account=name); throw e }
        catch(e: Exception) { status.value=DownloadStatus(message=e.message ?: "Metadata download failed",account=name); throw e }
        finally { revision.value++ }
    }
}
