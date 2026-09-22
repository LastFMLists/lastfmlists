package com.lastfmlists.app

import com.lastfmlists.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.*
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.io.IOException

class LastFmUnavailable(message: String): Exception(message)

class LastFm(private val apiKey: String) {
    private val requests=Mutex()
    private var lastRequest=0L
    suspend fun request(method: String,vararg parameters: Pair<String,String>): JSONObject = withContext(Dispatchers.IO) {
        requests.withLock {
            var failure: Exception=IOException("Last.fm could not be reached")
            repeat(5) { attempt ->
                currentCoroutineContext().ensureActive()
                delay((250-(android.os.SystemClock.elapsedRealtime()-lastRequest)).coerceAtLeast(0))
                lastRequest=android.os.SystemClock.elapsedRealtime()
                val query=(parameters.toList()+listOf("method" to method,"api_key" to apiKey,"format" to "json","autocorrect" to "0")).joinToString("&") { (k,v) -> "${URLEncoder.encode(k,"UTF-8")}=${URLEncoder.encode(v,"UTF-8")}" }
                val connection=URI("https://ws.audioscrobbler.com/2.0/?$query").toURL().openConnection() as HttpURLConnection
                connection.connectTimeout=15000; connection.readTimeout=20000; connection.setRequestProperty("User-Agent","lastfmlists-android/0.5")
                try {
                    val code=connection.responseCode
                    if(code==429 || code>=500) throw IOException("Last.fm is busy. Your download has been saved and can resume.")
                    if(code==404) throw LastFmUnavailable("Not found on Last.fm")
                    if(code !in 200..299) throw IllegalStateException("Last.fm returned HTTP $code")
                    val body=connection.inputStream.bufferedReader().use { it.readText() }
                    currentCoroutineContext().ensureActive()
                    val json=JSONObject(body)
                    if(json.has("error")) {
                        val error=json.optInt("error")
                        if(error in listOf(11,16,29)) throw IOException("Last.fm is temporarily unavailable. Please try again.")
                        if(error==6) throw LastFmUnavailable(json.optString("message","Not found on Last.fm"))
                        throw IllegalArgumentException(json.optString("message","Last.fm rejected the request"))
                    }
                    return@withLock json
                } catch(e: IOException) { failure=e } finally { connection.disconnect() }
                if(attempt<4) delay(1000L shl attempt)
            }
            throw failure
        }
    }
    suspend fun profile(username: String): String {
        val user=request("user.getinfo","user" to username).getJSONObject("user")
        return image(user).ifBlank {user.optString("avatar").takeIf {it.startsWith("https://")} ?: ""}
    }
    data class Page(val plays: List<Scrobble>,val totalPages: Int)
    suspend fun page(a: Account,page: Int): Page {
        val args=mutableListOf("user" to a.name,"limit" to "200","page" to page.toString(),"to" to a.until.toString())
        if(a.from>0) args.add("from" to (a.from-1).toString())
        val j=request("user.getrecenttracks",*args.toTypedArray()).getJSONObject("recenttracks")
        val plays=objects(j,"track").mapNotNull { t ->
            val seconds=t.optJSONObject("date")?.optLong("uts") ?: 0
            if(seconds<=0 || seconds<a.from || seconds>a.until || t.optJSONObject("@attr")?.optString("nowplaying")=="true") null
            else Scrobble(t.optJSONObject("artist")?.optString("#text") ?: "",t.optJSONObject("album")?.optString("#text") ?: "",t.optString("name"),seconds*1000,image(t))
        }.filter { it.artist.isNotBlank() && it.track.isNotBlank() }
        val pages=j.optJSONObject("@attr")?.optInt("totalPages",1)?.coerceAtLeast(1) ?: 1
        return Page(plays,pages)
    }
    suspend fun detail(type: EntityType,s: Scrobble): Metadata {
        val kind=type.name.canonical(); val args=mutableListOf("artist" to s.artist)
        if(type!=EntityType.ARTIST) args.add(kind to if(type==EntityType.ALBUM) s.album else s.track)
        val j=request("$kind.getinfo",*args.toTypedArray()).getJSONObject(kind)
        val stats=j.optJSONObject("stats") ?: j
        val tagObject=j.optJSONObject("tags") ?: j.optJSONObject("toptags")
        fun number(o: JSONObject,key: String)=o.optString(key).toLongOrNull()
        return Metadata(number(stats,"listeners"),number(stats,"playcount"),number(j,"duration"),tagObject?.let { objects(it,"tag").map { tag -> tag.optString("name") } } ?: emptyList(),image(j).ifBlank { j.optJSONObject("album")?.let(::image) ?: "" })
    }
    companion object {
        fun objects(j: JSONObject,key: String): List<JSONObject> = when(val value=j.opt(key)) { is JSONArray -> List(value.length()) { value.optJSONObject(it) }.filterNotNull(); is JSONObject -> listOf(value); else -> emptyList() }
        fun image(j: JSONObject): String = objects(j,"image").map { it.optString("#text") }.lastOrNull { it.startsWith("https://") && !it.contains("2a96cbd8b46e442fc41c2b86b821562f") } ?: ""
    }
}
