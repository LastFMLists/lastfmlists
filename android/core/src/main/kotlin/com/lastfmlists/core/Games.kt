package com.lastfmlists.core

import java.text.Normalizer
import kotlin.random.Random

class Games(private val analytics: Analytics,private val random: Random=Random.Default) {
    data class Puzzle(val prompt: String,val query: Query,val answers: List<ResultRow>,val category: String)
    private val recent=ArrayDeque<String>()
    private val recentPairs=ArrayDeque<String>()
    private val categoryDeck=ArrayDeque<String>()
    fun pair(type: EntityType,round: Int): List<ResultRow> {
        val depth=when { round<3 -> 50; round<6 -> 100; round<10 -> 250; round<15 -> 500; else -> Int.MAX_VALUE }
        val rankMax=when(type) {EntityType.ARTIST -> 300;EntityType.ALBUM -> 500;else -> 1000}
        val minCount=when(type) {EntityType.ARTIST -> 100;EntityType.ALBUM -> 50;else -> 10}
        val pool=analytics.analyze(Query(type=type,limit=0)).rows.filterIndexed {i,row -> i<rankMax || row.count>=minCount}.take(depth)
        if(pool.size<2) return emptyList()
        val candidates=pool.shuffled(random).sortedBy {if(it.key in recentPairs) 1 else 0}
        val ratio=when { round<3 -> 2.0; round<6 -> 1.6; round<10 -> 1.35; round<15 -> 1.15; else -> 1.01 }
        val maximum=when {round<3 -> 3.0;round<6 -> 2.2;round<10 -> 1.7;round<15 -> 1.4;else -> 1.15}
        var best=candidates.take(2);var bestError=Double.POSITIVE_INFINITY
        for(a in candidates.take(16)) {
            val b=candidates.filter {it.key!=a.key}.minByOrNull {kotlin.math.abs(kotlin.math.ln(maxOf(it.count,a.count).toDouble()/minOf(it.count,a.count)/kotlin.math.sqrt(ratio*maximum)))} ?: continue
            val actual=maxOf(a.count,b.count).toDouble()/minOf(a.count,b.count)
            val error=kotlin.math.abs(kotlin.math.ln(actual/kotlin.math.sqrt(ratio*maximum)))
            if(error<bestError) {best=listOf(a,b);bestError=error}
            if(actual>=ratio*0.85 && actual<=maximum*1.35) break
        }
        best.forEach {recentPairs.addLast(it.key)};while(recentPairs.size>12) recentPairs.removeFirst()
        return best.shuffled(random)
    }
    fun ordering(type: EntityType,round: Int): Puzzle? {
        val metrics=listOf("scrobbles","separate-days","consecutive-scrobbles","max-single-day","first-discovery","latest-play","period")+(if(type!=EntityType.TRACK) listOf("distinct-tracks","biggest-track") else emptyList())
        val n=when { round<2 -> 3; round<7 -> 4; else -> 5 }
        val depth=when { round<2 -> 30; round<4 -> 60; round<7 -> 120; round<11 -> 250; else -> 600 }
        val cap=when(type) {EntityType.ARTIST -> 200;EntityType.ALBUM -> 300;else -> 600}
        val familiarRows=analytics.analyze(Query(type=type,limit=minOf(depth,cap))).rows.filter {it.count>=5}
        val familiar=familiarRows.map { it.key }.toSet()
        val ratio=when {round<2 -> 2.5;round<4 -> 2.0;round<7 -> 1.7;round<11 -> 1.5;else -> 1.35}
        val dayGap=when {round<2 -> 120;round<4 -> 90;round<7 -> 60;round<11 -> 35;else -> 21}
        for(sort in metrics.shuffled(random).sortedBy { if(it in recent) 1 else 0 }) {
            var q=Query(type=type,sort=sort,x=5,limit=0)
            var label=Catalog.sorts.firstOrNull {it.first==sort}?.second ?: ""
            val pool=when(sort) {
                "first-discovery","latest-play","distinct-tracks" -> {
                    label=when(sort) {"first-discovery" -> "First discovered · earliest first";"latest-play" -> "Most recently played first";else -> "Most different tracks"}
                    val rows=familiarRows.map {row -> val st=analytics.stats[type]!![row.key]!!;row.copy(value=when(sort) {"first-discovery" -> st.first.toDouble();"latest-play" -> st.last.toDouble();else -> st.tracks.toDouble()})}
                    if(sort=="first-discovery") rows.sortedBy {it.value} else rows.sortedByDescending {it.value}
                }
                "biggest-track" -> {
                    label="Biggest single track · most plays first"
                    val counts=analytics.history.groupBy {it.key(type)}.mapValues {(_,plays) -> plays.groupingBy {it.key(EntityType.TRACK)}.eachCount().values.maxOrNull() ?: 0}
                    familiarRows.map {it.copy(value=counts.getValue(it.key).toDouble())}.sortedByDescending {it.value}
                }
                "period" -> {
                    val year=analytics.history.map {analytics.date(it).year}.distinct().randomOrNull(random)
                    val days=listOf(30,90,180,365).random(random)
                    val useYear=year!=null && random.nextBoolean()
                    label=if(useYear) "Most scrobbles in $year" else "Most scrobbles in the last $days days"
                    q=q.copy(sort="scrobbles",filters=if(useYear) mapOf("year" to year.toString()) else mapOf("last-n-days" to days.toString()))
                    analytics.analyze(q).rows.filter {it.key in familiar}
                }
                else -> analytics.analyze(q).rows.filter {it.key in familiar}
            }.distinctBy {it.value}
            if(pool.size<n) continue
            var answers=emptyList<ResultRow>()
            for(start in pool.indices.take(maxOf(1,pool.size/3)).shuffled(random)) {
                val selection=mutableListOf(pool[start])
                for(candidate in pool.drop(start+1)) {
                    val previous=selection.last().value
                    val separated=if(sort in listOf("first-discovery","latest-play")) kotlin.math.abs(previous-candidate.value)>=dayGap*86400000.0 else minOf(previous,candidate.value)>0 && maxOf(previous,candidate.value)/minOf(previous,candidate.value)>=ratio && kotlin.math.abs(previous-candidate.value)>=2
                    if(separated) selection.add(candidate)
                    if(selection.size==n) break
                }
                if(selection.size==n) {answers=selection;break}
            }
            if(answers.isEmpty()) continue
            recent.addLast(sort); while(recent.size>5) recent.removeFirst()
            return Puzzle("${type.title}: $label",q,answers,"Ordering")
        }
        return null
    }
    fun fill(types: Set<EntityType>,categories: Set<String>): Puzzle? {
        if(types.isEmpty() || categories.isEmpty()) return null
        if(categoryDeck.isEmpty() || categoryDeck.any { it !in categories }) { categoryDeck.clear(); categoryDeck.addAll(categories.shuffled(random)) }
        val category=categoryDeck.removeFirst()
        val candidates=mutableListOf<Pair<String,Query>>()
        val history=analytics.history
        for(type in types.shuffled(random)) {
            val kind=type.name.canonical(); val q=Query(type=type,limit=0)
            when(category) {
                "Time" -> {
                    history.map { analytics.date(it).year }.distinct().forEach { year -> candidates.add("Your top ${type.title.canonical()} in $year" to q.copy(filters=mapOf("year" to year.toString()))) }
                    history.map { val d=analytics.date(it);d.year to d.monthValue }.distinct().forEach { (year,month) -> candidates.add("Your top ${type.title.canonical()} in $year-${month.toString().padStart(2,'0')}" to q.copy(filters=mapOf("year" to year.toString(),"month" to month.toString()))) }
                    (1..12).forEach { month -> candidates.add("Your top ${type.title.canonical()} in month $month, all years" to q.copy(filters=mapOf("month" to month.toString()))) }
                    listOf(7,30,90,180,365).forEach { days -> candidates.add("Your top ${type.title.canonical()} in the last $days days" to q.copy(filters=mapOf("last-n-days" to days.toString()))) }
                }
                "Names & words" -> {
                    history.map { it.title(type).take(1) }.distinct().forEach { letter -> candidates.add("${type.title} starting with $letter" to q.copy(filters=mapOf("$kind-initial" to letter))) }
                    history.flatMap { it.title(type).split(' ') }.map { it.canonical() }.filter { it.length>=3 }.groupingBy { it }.eachCount().entries.sortedByDescending { it.value }.take(30).forEach { (word,_) -> candidates.add("${type.title} containing ‘$word’" to q.copy(filters=mapOf("$kind-includes" to word))) }
                }
                "Deep cuts" -> {
                    listOf(30,365).forEach { days -> candidates.add("${type.title} not played in $days days" to q.copy(filters=mapOf("$kind-days-since-last-min" to days.toString()))) }
                    history.map { analytics.date(it).year }.distinct().forEach { year -> candidates.add("${type.title} first played in $year" to q.copy(filters=mapOf("$kind-first-scrobble-years" to year.toString()))) }
                    if(type==EntityType.ARTIST) candidates.add("Artists with only one track in your library" to q.copy(filters=mapOf("artist-track-count-max" to "1")))
                }
                "Streaks & sequences" -> {
                    listOf("max-single-day","separate-days","consecutive-days").forEach { sort -> candidates.add("${type.title}: ${Catalog.sorts.first { it.first==sort }.second}" to q.copy(sort=sort)) }
                    listOf(50,100,200).forEach { x -> listOf("first-n-scrobbles","fastest-n-scrobbles").forEach { sort -> candidates.add("${type.title}: ${Catalog.sorts.first { it.first==sort }.second.replace("X",x.toString())}" to q.copy(sort=sort,x=x)) } }
                    (0..history.size/10000).forEach { window -> candidates.add("${type.title} from scrobbles ${window*10000+1}–${(window+1)*10000}" to q.copy(filters=mapOf("scrobble-order-from" to (window*10000+1).toString(),"scrobble-order-to" to ((window+1)*10000).toString()))) }
                }
                "By artist" -> if(type!=EntityType.ARTIST) history.map { it.artist }.distinct().forEach { artist -> candidates.add("Top ${type.title.canonical()} by $artist" to q.copy(filters=mapOf("artist-name" to artist))) }
            }
        }
        for((prompt,q) in candidates.shuffled(random).take(80)) {
            if(prompt in recent) continue
            val answers=analytics.analyze(q).rows.filter { it.count>=5 }.take(10)
            if(answers.size==10) { recent.addLast(prompt); while(recent.size>20) recent.removeFirst(); return Puzzle(prompt,q,answers,category) }
        }
        for(type in types.shuffled(random)) {
            val q=Query(type=type,limit=0); val answers=analytics.analyze(q).rows.filter { it.count>=5 }.take(10)
            if(answers.size==10) return Puzzle("Your all-time top ${type.title.canonical()}",q,answers,"Overall")
        }
        return null
    }
    companion object {
        val categories=listOf("Time","Names & words","Deep cuts","Streaks & sequences","By artist")
        fun normalize(text: String): String {
            val stripped=text.replace(Regex("\\s*[\\[(\\-].*(remaster|deluxe|edition|live|remix|feat\\.).*$",RegexOption.IGNORE_CASE),"").trim()
            val folded=Normalizer.normalize(stripped,Normalizer.Form.NFD).replace(Regex("\\p{M}+"),"").canonical()
            return folded.replace(Regex("[^\\p{L}\\p{N}]"),"").ifBlank { folded }
        }
        fun matches(typed: String,answer: String,enter: Boolean=false): Boolean {
            val gloss=Regex("[（(]([^）)]+)[）)]").find(answer)
            if(gloss!=null) {
                val main=answer.substringBefore(gloss.value)
                val latin=gloss.groupValues[1]
                val qualifier=Regex("edition|deluxe|remaster|live|remix|version|bonus|demo|acoustic|instrumental|edit|mono|stereo|feat|mix|soundtrack|radio|session|anniversary|original|explicit|clean",RegexOption.IGNORE_CASE)
                if(!main.contains(Regex("[A-Za-z]")) && latin.contains(Regex("[A-Za-z]")) && !qualifier.containsMatchIn(latin) && matches(typed,latin,enter)) return true
            }
            val a=normalize(typed); val b=normalize(answer)
            if(a.isEmpty()) return false
            if(a==b) return true
            if(enter && a.length>=maxOf(3,(b.length+1)/2) && b.startsWith(a)) return true
            if(a.length<b.length || b.length<5) return false
            var prev=IntArray(b.length+1) { it }
            a.forEachIndexed { i,c -> val next=IntArray(b.length+1); next[0]=i+1; b.forEachIndexed { j,d -> next[j+1]=minOf(next[j]+1,prev[j+1]+1,prev[j]+if(c==d) 0 else 1) }; prev=next }
            return prev[b.length]<=floorOfTolerance(b.length)
        }
        private fun floorOfTolerance(length: Int)=(length*0.12).toInt().coerceAtLeast(1)
    }
}
