package com.lastfmlists.app

import android.content.SharedPreferences
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.lastfmlists.core.*
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

data class ListSnapshot(val left: Query,val right: Query,val comparison: Boolean,val time: Long=System.currentTimeMillis())
object QueryJson {
    fun encode(q: Query)=JSONObject().put("type",q.type.name).put("sort",q.sort).put("x",q.x).put("limit",q.limit).put("max",q.maxPerArtist).put("equations",q.equations).put("filters",JSONObject().apply {q.filters.filterValues {it.isNotBlank()}.toSortedMap().forEach {(k,v)->put(k,v)}})
    fun decode(j: JSONObject): Query {val f=j.optJSONObject("filters") ?: JSONObject();return Query(EntityType.valueOf(j.getString("type")),j.getString("sort"),j.getInt("x"),j.getInt("limit"),j.getInt("max"),f.keys().asSequence().associateWith {f.getString(it)},j.optString("equations"))}
    fun signature(q: Query)=encode(q).toString()
    fun hash(account: String,q: Query)=MessageDigest.getInstance("SHA-256").digest((account+signature(q)).toByteArray()).joinToString("") {"%02x".format(it)}
}
class ListHistory(private val prefs: SharedPreferences) {
    fun read(account: String): List<ListSnapshot> = runCatching {
        val a=JSONArray(prefs.getString("listHistory.$account","[]"));List(a.length()) {i->val j=a.getJSONObject(i);ListSnapshot(QueryJson.decode(j.getJSONObject("left")),QueryJson.decode(j.getJSONObject("right")),j.getBoolean("comparison"),j.getLong("time"))}
    }.getOrDefault(emptyList())
    fun record(account: String,s: ListSnapshot): List<ListSnapshot> {
        val entries=(listOf(s)+read(account).filterNot {it.left==s.left && it.comparison==s.comparison && (!s.comparison || it.right==s.right)}).take(50)
        val a=JSONArray();entries.forEach {a.put(JSONObject().put("left",QueryJson.encode(it.left)).put("right",QueryJson.encode(it.right)).put("comparison",it.comparison).put("time",it.time))}
        prefs.edit().putString("listHistory.$account",a.toString()).apply();return entries
    }
}

@Composable fun HistoryPanel(vm: MainViewModel,onClose: ()->Unit) {
    val entries=remember(vm.username) {ListHistory(vm.app.prefs).read(vm.username)}
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        item {Text("Recent lists for ${vm.displayName}. Restoring a list restores its filters, rules, limits and comparison settings.")}
        if(entries.isEmpty()) item {Text("No saved list views yet.")}
        items(entries) {entry ->
            OutlinedCard(onClick={vm.restoreList(entry);onClose()},modifier=Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                    Text(if(entry.comparison) "Comparison" else entry.left.type.title,style=MaterialTheme.typography.titleMedium)
                    Text(queryDescription(entry.left),style=MaterialTheme.typography.bodySmall)
                    if(entry.comparison) Text("Right: ${queryDescription(entry.right)}",style=MaterialTheme.typography.bodySmall)
                    Text(java.time.Instant.ofEpochMilli(entry.time).atZone(java.time.ZoneId.systemDefault()).toLocalDateTime().withSecond(0).withNano(0).toString().replace('T',' '),style=MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}
private fun queryDescription(q: Query): String {
    val sort=Catalog.sorts.firstOrNull {it.first==q.sort}?.second?.replace("X",q.x.toString()) ?: q.sort
    val filters=q.filters.filterValues {it.isNotBlank()}.map {(k,v)->"${Catalog.fields.firstOrNull {it.id==k}?.let {it.group+" "+it.label} ?: k}: $v"}
    return (listOf("${q.type.title} · $sort",if(q.limit==0) "All results" else "${q.limit} results")+filters+(if(q.equations.isNotBlank()) listOf("Rules: ${q.equations}") else emptyList())).joinToString("\n")
}
