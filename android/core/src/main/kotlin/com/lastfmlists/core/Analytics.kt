package com.lastfmlists.core

import java.time.*
import kotlin.math.floor

/** Pure JVM analysis; no UI, networking or persistence dependencies. */
class Analytics(history: List<Scrobble>, val metadata: Map<Pair<EntityType,String>, Metadata> = emptyMap(), val zone: ZoneId = ZoneId.systemDefault(), val now: Long = System.currentTimeMillis()) {
    val history = history.sortedBy { it.timestamp }.mapIndexed { i,s -> s.copy(order=i+1) }
    val stats: Map<EntityType,Map<String,EntityStats>> = listOf(EntityType.TRACK,EntityType.ALBUM,EntityType.ARTIST).associateWith { type ->
        this.history.groupBy { it.key(type) }.entries.sortedByDescending { it.value.size }.mapIndexed { i,(key,plays) ->
            key to EntityStats(plays.size,i+1,plays.first().timestamp,plays.last().timestamp,plays.map { it.key(EntityType.TRACK) }.toSet().size,plays.map { it.timestamp.toDouble() }.average())
        }.toMap()
    }
    fun date(s: Scrobble) = Instant.ofEpochMilli(s.timestamp).atZone(zone)
    fun meta(s: Scrobble, type: EntityType) = metadata[type to s.key(type)]
    fun field(s: Scrobble, name: String, x: Int = 1): Any? {
        val type = when(name.substringBefore('-')) { "artist" -> EntityType.ARTIST; "album" -> EntityType.ALBUM; else -> EntityType.TRACK }
        val text = when(type) { EntityType.ARTIST -> s.artist; EntityType.ALBUM -> s.album; else -> s.track }
        val st = stats[type]?.get(s.key(type)) ?: return null
        val m = meta(s,type)
        return when(name) {
            "year" -> date(s).year.toDouble(); "month" -> date(s).monthValue.toDouble(); "day-of-month" -> date(s).dayOfMonth.toDouble(); "weekday" -> (date(s).dayOfWeek.value%7).toDouble()
            "scrobble-order" -> s.order.toDouble()
            "oldest-average-listening-time" -> st.average.takeIf { st.count >= x }
            "newest-average-listening-time" -> (-st.average).takeIf { st.count >= x }
            else -> when(name.substringAfter('-')) {
                "name" -> text; "name-length" -> text.length.toDouble(); "word-count" -> text.trim().split(Regex("\\s+")).size.toDouble()
                "scrobble-count" -> st.count.toDouble(); "rank" -> st.rank.toDouble(); "track-count" -> st.tracks.toDouble()
                "first-scrobble-year" -> Instant.ofEpochMilli(st.first).atZone(zone).year.toDouble()
                "days-since-last" -> floor((now-st.last)/86400000.0)
                "listeners" -> m?.listeners?.toDouble(); "global-scrobbles" -> m?.globalPlays?.toDouble(); "duration" -> m?.durationMs?.div(1000.0)
                else -> null
            }
        }
    }
    private fun validate(filters: Map<String,String>) {
        filters.filterValues { it.isNotBlank() }.forEach { (id,v) ->
            require(Catalog.fields.any { it.id == id }) { "Unknown filter: $id" }
            when {
                id.startsWith("date-range-") -> require(runCatching { LocalDate.parse(v) }.isSuccess) { "$id needs YYYY-MM-DD" }
                id.startsWith("time-of-day-") -> require(runCatching { LocalTime.parse(v) }.isSuccess) { "$id needs HH:mm" }
                id.endsWith("-min") || id.endsWith("-max") || id in listOf("last-n-days","day-starter-gap-hours","scrobble-order-from","scrobble-order-to") -> require(v.toDoubleOrNull()?.let { it.isFinite() && it >= 0 } == true) { "$id needs a non-negative number" }
                id in listOf("year","month","day-of-month","weekday") || id.endsWith("-years") -> {
                    val numbers=v.split(',').map { it.trim().toIntOrNull() }
                    val range=when(id) { "month" -> 1..12; "day-of-month" -> 1..31; "weekday" -> 0..6; else -> 1..9999 }
                    require(numbers.all { it != null && it in range }) { "$id needs comma-separated numbers in $range" }
                }
            }
        }
    }
    fun filtered(q: Query, source: List<Scrobble> = history): List<Scrobble> {
        validate(q.filters)
        val active=q.filters.filterValues { it.isNotBlank() }
        val fromTime=active["time-of-day-start"]?.let(LocalTime::parse)
        val toTime=active["time-of-day-end"]?.let(LocalTime::parse)
        val gap=(active["day-starter-gap-hours"]?.toDoubleOrNull() ?: 6.0)*3600000
        return source.filter { s ->
            active.all { (id,v) ->
                val kind=id.substringBefore('-')
                val text=when(kind) { "artist" -> s.artist; "album" -> s.album; else -> s.track }
                when {
                    id.endsWith("-name") -> text.equals(v,true)
                    id.endsWith("-initial") -> text.startsWith(v,true)
                    id.endsWith("-includes") -> matches(v,text)
                    id.endsWith("-excludes") -> !matches(v,text)
                    id == "artist-tags" -> matches(v,meta(s,EntityType.ARTIST)?.tags?.joinToString(" ") ?: "")
                    id.endsWith("-min") || id.endsWith("-max") -> (field(s,id.substringBeforeLast('-')) as? Double)?.let { if(id.endsWith("-min")) it >= v.toDouble() else it <= v.toDouble() } ?: false
                    id.endsWith("-first-scrobble-years") -> (field(s,"$kind-first-scrobble-year") as? Double)?.toInt() in v.split(',').map { it.trim().toInt() }
                    id in listOf("year","month","day-of-month","weekday") -> (field(s,id) as Double).toInt() in v.split(',').map { it.trim().toInt() }
                    id.startsWith("time-of-day-") -> {
                        val time=date(s).toLocalTime().withSecond(0).withNano(0)
                        if(fromTime!=null && toTime!=null && fromTime>toTime) time>=fromTime || time<=toTime
                        else (fromTime==null || time>=fromTime) && (toTime==null || time<=toTime)
                    }
                    id == "date-range-start" -> date(s).toLocalDate() >= LocalDate.parse(v)
                    id == "date-range-end" -> date(s).toLocalDate() <= LocalDate.parse(v)
                    id == "last-n-days" -> now-s.timestamp <= v.toDouble()*86400000
                    id == "scrobble-order-from" -> s.order>=v.toDouble()
                    id == "scrobble-order-to" -> s.order<=v.toDouble()
                    id == "session-starter-only" || id == "day-starter-only" -> {
                        val previous=history.getOrNull(s.order-2)
                        val longGap=previous==null || s.timestamp-previous.timestamp>=gap
                        val first=previous==null || date(previous).toLocalDate()!=date(s).toLocalDate()
                        when(v) { "use-gap" -> longGap; "first-day-literal" -> first; "first-day-smart" -> first && longGap; else -> true }
                    }
                    else -> true
                }
            }
        }
    }
    fun analyze(q: Query): Analysis {
        require(q.x>0 && q.limit>=0 && q.maxPerArtist>=0) { "X must be positive; limits cannot be negative." }
        val pipeline=Equations(this,q.x).apply(filtered(q),q.equations)
        val source=pipeline.tracks
        val ordered=source.sortedBy { it.timestamp }
        val type=q.type
        val sort=if(type==EntityType.SCROBBLE) (if(q.sort=="latest-to-earliest") q.sort else "earliest-to-latest") else q.sort
        val groups=if(type==EntityType.SCROBBLE) source.map { it.order.toString() to listOf(it) } else source.groupBy { it.key(type) }.toList()
        var rows=groups.mapNotNull { (key,plays) ->
            val chronological=plays.sortedBy { it.timestamp }
            val s=plays.first()
            val st=stats[if(type==EntityType.SCROBBLE) EntityType.TRACK else type]?.get(s.key(type))
            val value=if(pipeline.ordered && type==EntityType.TRACK) plays.size.toDouble() else metric(chronological,type,sort,q.x) ?: return@mapNotNull null
            val shown=pipeline.shown.associateWith { name -> field(s,name,q.x)?.toString() ?: "Unavailable" }
            val artwork=s.image.ifBlank { meta(s,type)?.image.orEmpty().ifBlank {meta(s,EntityType.ALBUM)?.image.orEmpty()} }
            ResultRow(key,s.title(type),if(type==EntityType.ARTIST) "" else s.artist,s.copy(image=artwork),plays.size,value,st?.count ?: plays.size,st?.rank ?: 0,shown,type)
        }
        if(!(pipeline.ordered && type==EntityType.TRACK)) {
            val asc=sort in listOf("earliest-to-latest","first-n-scrobbles","fastest-n-scrobbles","oldest-average-listening-time")
            rows=if(asc) rows.sortedBy { it.value } else rows.sortedByDescending { it.value }
        }
        if(q.maxPerArtist>0 && type in listOf(EntityType.TRACK,EntityType.SCROBBLE)) {
            val counts=mutableMapOf<String,Int>()
            rows=rows.filter { val key=it.sample.artist.canonical(); val n=counts.getOrDefault(key,0); counts[key]=n+1; n<q.maxPerArtist }
        }
        val size=rows.size
        return Analysis(if(q.limit==0) rows else rows.take(q.limit),ordered.size,size)
    }
    private fun period(s: Scrobble, unit: String, consecutive: Boolean = false): Long {
        val d=date(s).toLocalDate()
        return when(unit) {
            "weeks","week" -> if(consecutive) Math.floorDiv(d.toEpochDay()+3,7) else d.year*100L+((d.dayOfYear-1+LocalDate.of(d.year,1,1).dayOfWeek.value%7)/7+1)
            "months","month" -> d.year*12L+d.monthValue-1
            else -> d.toEpochDay()
        }
    }
    private fun metric(p: List<Scrobble>,type: EntityType,sort: String,x: Int): Double? = when {
        sort in listOf("earliest-to-latest","latest-to-earliest") || type==EntityType.SCROBBLE -> p.first().timestamp.toDouble()
        sort.startsWith("separate-") -> p.map { period(it,sort.substringAfter("separate-")) }.toSet().size.toDouble()
        sort.startsWith("max-single-") -> p.groupingBy { period(it,sort.substringAfter("max-single-")) }.eachCount().values.maxOrNull()?.toDouble()
        sort.startsWith("max-rolling-") -> {
            val hours=when(sort) { "max-rolling-24h" -> 24; "max-rolling-168h" -> 168; else -> x }
            var left=0; var best=0
            p.indices.forEach { right -> while(p[right].timestamp-p[left].timestamp>hours*3600000L) left++; best=maxOf(best,right-left+1) }
            best.toDouble()
        }
        sort == "consecutive-scrobbles" -> { var best=0; var run=0; var prev=-2; p.forEach { run=if(it.order==prev+1) run+1 else 1; prev=it.order; best=maxOf(best,run) }; best.toDouble() }
        sort.startsWith("consecutive-") -> { var best=0; var run=0; var prev=Long.MIN_VALUE; p.map { period(it,sort.substringAfter("consecutive-"),true) }.distinct().forEach { run=if(it==prev+1) run+1 else 1; prev=it; best=maxOf(best,run) }; best.toDouble() }
        sort == "first-n-scrobbles" -> p.getOrNull(x-1)?.timestamp?.toDouble()
        sort == "fastest-n-scrobbles" -> p.getOrNull(x-1)?.let { (it.timestamp-p.first().timestamp).toDouble() }
        sort.endsWith("average-listening-time") -> if(p.size<x) null else floor(p.map { it.timestamp.toDouble() }.average())
        sort == "time-spent-listening" -> p.sumOf { meta(it,EntityType.TRACK)?.durationMs ?: 0 }.toDouble()
        sort == "highest-listening-percentage" -> { val total=meta(p.first(),type)?.globalPlays ?: 0; if(total<=0) 0.0 else (stats[type]?.get(p.first().key(type))?.count ?: 0)*100.0/total }
        else -> p.size.toDouble()
    }
    companion object {
        fun matches(input: String,value: String): Boolean {
            fun normalize(s: String)=s.trim().canonical().replace("-", "")
            val text=normalize(value)
            return input.split(';').all { group -> group.split(',').map(::normalize).filter { it.isNotEmpty() }.any { text.contains(it) } }
        }
    }
}
