package com.lastfmlists.app

import android.app.Application
import android.net.Uri
import androidx.compose.runtime.*
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.lastfmlists.core.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest
import org.json.JSONObject
import java.time.*

class MainViewModel(application: Application): AndroidViewModel(application) {
    val app=application as ListsApplication
    var username by mutableStateOf(app.prefs.getString("username","") ?: ""); private set
    var accounts by mutableStateOf<List<Account>>(emptyList()); private set
    var account by mutableStateOf<Account?>(null); private set
    var analytics by mutableStateOf<Analytics?>(null); private set
    var left by mutableStateOf(readQuery("left")); private set
    var right by mutableStateOf(readQuery("right")); private set
    var comparison by mutableStateOf(app.prefs.getBoolean("comparison",false)); private set
    var leftResult by mutableStateOf(Analysis(emptyList(),0,0)); private set
    var rightResult by mutableStateOf(Analysis(emptyList(),0,0)); private set
    var calculating by mutableStateOf(false); private set
    var loading by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null)
    var background by mutableStateOf(app.prefs.getBoolean("background",false)); private set
    var wifiOnly by mutableStateOf(app.prefs.getBoolean("wifiOnly",true)); private set
    var theme by mutableStateOf(app.prefs.getString("theme","System") ?: "System"); private set
    var tab by mutableIntStateOf(0)
    var selectedEntity by mutableStateOf<ResultRow?>(null)
    var supportPrompt by mutableStateOf(false)
    fun saveViewedList() {
        if(!calculating && !analytics?.history.isNullOrEmpty() && error==null) ListHistory(app.prefs).record(username,ListSnapshot(left,right,comparison))
    }
    fun listViewed() {
        if(calculating || analytics?.history.isNullOrEmpty() || error!=null) return
        saveViewedList()
        if(leftResult.rows.isEmpty() && (!comparison || rightResult.rows.isEmpty())) return
        if(app.prefs.getBoolean("hideSupportPrompt",false) || app.prefs.getBoolean("listSupportShown",false)) return
        val seen=app.prefs.getStringSet("viewedListKeys",emptySet()).orEmpty().toMutableSet()
        if(leftResult.rows.isNotEmpty()) seen.add(QueryJson.hash(username,left));if(comparison && rightResult.rows.isNotEmpty()) seen.add(QueryJson.hash(username,right))
        app.prefs.edit().putStringSet("viewedListKeys",seen).apply()
        if(seen.size>=5 && (BuildConfig.DEBUG || BuildConfig.EXTERNAL_TIPS_ENABLED)) supportPrompt=true
    }
    fun supportShown() {app.prefs.edit().putBoolean("listSupportShown",true).apply()}
    fun dismissSupport(forever: Boolean=false) {supportPrompt=false;if(forever) app.prefs.edit().putBoolean("hideSupportPrompt",true).apply()}
    fun restoreList(s: ListSnapshot) {left=s.left;right=s.right;comparison=s.comparison;saveQuery("left",left);saveQuery("right",right);app.prefs.edit().putBoolean("comparison",comparison).apply();tab=0;analyze()}
    var games: Games?=null; private set
    val game=GameSession()
    private var download: Job?=null
    private var calculation: Job?=null
    private var reloadJob: Job?=null
    val displayName get()=accountLabel(username)
    fun accountLabel(key: String)=app.prefs.getString("displayName.$key",key) ?: key
    val isDemo get()=username=="sample-library"
    val isImported get()=username.endsWith("-import")
    val canSync get()=!isDemo && !isImported && username.isNotBlank()
    val status get()=app.sync.status
    init {
        viewModelScope.launch { app.sync.revision.collectLatest { reload() } }
    }
    fun reload() {
        reloadJob?.cancel()
        reloadJob=viewModelScope.launch {
            loading=true
            try {
                val name=username
                val result=withContext(Dispatchers.IO) {
                    val accounts=app.store.accounts()
                    val history=if(name=="sample-library") demoHistory() else app.store.history(name)
                    Triple(accounts,accounts.firstOrNull { it.name==name },Analytics(history,if(name=="sample-library") emptyMap() else app.store.metadata(name)))
                }
                if(username!=name) return@launch
                accounts=result.first; account=result.second; analytics=result.third
                games=Games(result.third)
                analyze()
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { error=e.message ?: "Could not open saved library" }
            finally { loading=false }
        }
    }
    fun chooseAccount(name: String,fetch: Boolean=true) {
        selectedEntity=null
        stopDownload(); val entered=name.trim(); username=entered.canonical(); if(fetch || app.prefs.getString("displayName.$username",null)==null) app.prefs.edit().putString("displayName.$username",entered).apply(); app.prefs.edit().putString("username",username).apply(); game.reset()
        analytics=null; leftResult=Analysis(emptyList(),0,0); rightResult=leftResult; error=null; reload()
        if(fetch && !isDemo) sync()
    }
    fun demo()=chooseAccount("sample-library",false)
    fun sync() {
        if(!canSync || status.value.running) return
        error=null
        if(background) { DownloadWorker.start(app,username,wifiOnly); return }
        download=viewModelScope.launch {
            try { app.sync.sync(username) }
            catch(e: CancellationException) { throw e }
            catch(e: Exception) { error=e.message }
        }
    }
    fun details(all: Boolean) {
        if(isDemo || status.value.running) return
        download=viewModelScope.launch {
            try { app.sync.details(username,all) }
            catch(e: CancellationException) { throw e }
            catch(e: Exception) { error=e.message }
        }
    }
    fun stopDownload() { download?.cancel(); DownloadWorker.cancel(app) }
    fun onBackground() { download?.cancel() }
    fun updateBackgroundConsent(value: Boolean) { background=value; app.prefs.edit().putBoolean("background",value).apply(); if(!value) DownloadWorker.cancel(app) }
    fun setWifi(value: Boolean) { wifiOnly=value; app.prefs.edit().putBoolean("wifiOnly",value).apply() }
    fun changeTheme(value: String) { theme=value; app.prefs.edit().putString("theme",value).apply() }
    fun compare(value: Boolean) { comparison=value; app.prefs.edit().putBoolean("comparison",value).apply(); analyze() }
    fun updateQuery(q: Query,isRight: Boolean=false) {
        val normalized=when {
            q.type==EntityType.SCROBBLE && q.sort !in listOf("earliest-to-latest","latest-to-earliest") -> q.copy(sort="earliest-to-latest")
            q.type!=EntityType.SCROBBLE && q.sort in listOf("earliest-to-latest","latest-to-earliest") -> q.copy(sort="scrobbles")
            else -> q
        }
        if(isRight) right=normalized else left=normalized
        saveQuery(if(isRight) "right" else "left",normalized); analyze()
    }
    fun analyze() {
        calculation?.cancel()
        calculation=viewModelScope.launch {
            calculating=true; error=null
            val engine=analytics ?: run { calculating=false; return@launch }
            val a=left; val b=right; val compare=comparison
            try {
                val results=withContext(Dispatchers.Default) { engine.analyze(a) to if(compare) engine.analyze(b) else Analysis(emptyList(),0,0) }
                ensureActive(); leftResult=results.first; rightResult=results.second
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { error=e.message ?: "Could not calculate this list" }
            finally { calculating=false }
        }
    }
    fun importCsv(uri: Uri) {
        stopDownload()
        viewModelScope.launch {
            loading=true
            try {
                val imported=withContext(Dispatchers.IO) { app.contentResolver.openInputStream(uri)?.bufferedReader()?.use { Csv.read(it.readText()) } ?: error("Could not read the selected file") }
                val name=imported.username.canonical()+"-import"
                withContext(Dispatchers.IO) { app.store.importHistory(name,imported.plays) }
                chooseAccount(name,false)
            } catch(e: CancellationException) { throw e }
            catch(e: Exception) { error=e.message ?: "CSV import failed" }
            finally { loading=false }
        }
    }
    fun removeAccount() {
        stopDownload()
        viewModelScope.launch {
            withContext(Dispatchers.IO) { app.store.deleteAccount(username) }
            username=""; app.prefs.edit().remove("username").apply(); analytics=null; game.reset(); reload()
        }
    }
    fun record(game: String,score: Int): Int { val key="record.$username.$game"; val best=maxOf(score,app.prefs.getInt(key,0)); app.prefs.edit().putInt(key,best).apply(); return best }
    fun savedRecord(game: String)=app.prefs.getInt("record.$username.$game",0)
    fun hasDetails()=analytics?.metadata?.isNotEmpty()==true
    private fun readQuery(key: String): Query = runCatching {
        val j=JSONObject(app.prefs.getString("query.$key","{}") ?: "{}")
        val f=j.optJSONObject("filters") ?: JSONObject()
        Query(EntityType.valueOf(j.optString("type","TRACK")),j.optString("sort","scrobbles"),j.optInt("x",10),j.optInt("limit",50),j.optInt("max",0),f.keys().asSequence().associateWith { f.getString(it) },j.optString("equations"))
    }.getOrDefault(Query())
    private fun saveQuery(key: String,q: Query) {
        val j=JSONObject().put("type",q.type.name).put("sort",q.sort).put("x",q.x).put("limit",q.limit).put("max",q.maxPerArtist).put("filters",JSONObject(q.filters)).put("equations",q.equations)
        app.prefs.edit().putString("query.$key",j.toString()).apply()
    }
}

class GameSession {
    var mode by mutableStateOf("")
    var type by mutableStateOf(EntityType.ARTIST)
    var streak by mutableIntStateOf(0)
    var best by mutableIntStateOf(0)
    var pair by mutableStateOf<List<ResultRow>>(emptyList())
    var feedback by mutableStateOf<String?>(null)
    var lost by mutableStateOf(false)
    var puzzle by mutableStateOf<Games.Puzzle?>(null)
    var ordered by mutableStateOf<List<ResultRow>>(emptyList())
    var found by mutableStateOf<Set<String>>(emptySet())
    var answer by mutableStateOf("")
    var revealed by mutableStateOf(false)
    var hard by mutableStateOf(false)
    var timeLimit by mutableIntStateOf(0)
    var deadline by mutableLongStateOf(0)
    var categories by mutableStateOf(Games.categories.toSet())
    var types by mutableStateOf(setOf(EntityType.ARTIST,EntityType.ALBUM,EntityType.TRACK))
    var busy by mutableStateOf(false)
    fun reset() { mode=""; streak=0; pair=emptyList(); puzzle=null; ordered=emptyList(); feedback=null; lost=false; found=emptySet(); answer=""; revealed=false; deadline=0 }
}

fun demoHistory(): List<Scrobble> {
    val artists=listOf("Radiohead","Björk","Kendrick Lamar","Portishead","Nujabes","Beach House","Massive Attack","Sufjan Stevens","Little Simz","Daft Punk","FKA twigs","Boards of Canada")
    val albums=listOf("In Rainbows","Vespertine","To Pimp a Butterfly","Dummy","Modal Soul","Bloom","Mezzanine","Illinois","Sometimes I Might Be Introvert","Discovery","MAGDALENE","Music Has the Right to Children")
    val titles=listOf("Weird Fishes / Arpeggi","Hidden Place","Alright","Glory Box","Feather","Myth","Teardrop","Chicago","Introvert","Digital Love","cellophane","Roygbiv")
    val anchor=LocalDate.now().minusDays(365).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
    return buildList {
        repeat(365) { day -> repeat(18) { play -> val artist=(day*7+play*play)%artists.size; add(Scrobble(artists[artist],albums[artist],if(play%3==0) "${titles[artist]} · Sample ${play/3+1}" else titles[artist],anchor+day*86400000L+(play+7)*1800000L)) } }
    }
}

