package com.lastfmlists.core

import java.time.*
import java.util.Locale

fun String.canonical() = lowercase(Locale.ROOT)
enum class EntityType(val title: String) { TRACK("Tracks"), ALBUM("Albums"), ARTIST("Artists"), SCROBBLE("Scrobbles") }
data class Scrobble(val artist: String, val album: String, val track: String, val timestamp: Long, val image: String = "", val order: Int = 0) {
    fun key(type: EntityType): String = when(type) {
        EntityType.ARTIST -> artist.canonical()
        EntityType.ALBUM -> artist.canonical() + "\u0000" + album.canonical()
        else -> artist.canonical() + "\u0000" + track.canonical()
    }
    fun title(type: EntityType) = when(type) { EntityType.ARTIST -> artist; EntityType.ALBUM -> album.ifBlank { "Unknown album" }; else -> track }
}
data class Metadata(val listeners: Long? = null, val globalPlays: Long? = null, val durationMs: Long? = null, val tags: List<String> = emptyList(), val image: String = "")
data class EntityStats(val count: Int, val rank: Int, val first: Long, val last: Long, val tracks: Int, val average: Double)
data class Query(val type: EntityType = EntityType.TRACK, val sort: String = "scrobbles", val x: Int = 10, val limit: Int = 50, val maxPerArtist: Int = 0, val filters: Map<String,String> = emptyMap(), val equations: String = "")
data class ResultRow(val key: String, val title: String, val artist: String, val sample: Scrobble, val count: Int, val value: Double, val fullCount: Int, val fullRank: Int, val extras: Map<String,String> = emptyMap(), val type: EntityType = EntityType.TRACK)
data class Analysis(val rows: List<ResultRow>, val matchingScrobbles: Int, val totalEntities: Int)
data class FilterField(val id: String, val label: String, val group: String, val hint: String = "", val detailed: Boolean = false, val options: List<Pair<String,String>> = emptyList())

object Catalog {
    val sorts = listOf(
        "scrobbles" to "Scrobble count", "separate-days" to "Different days", "separate-weeks" to "Different weeks", "separate-months" to "Different months",
        "consecutive-scrobbles" to "Consecutive scrobbles", "consecutive-days" to "Listening streak · days", "consecutive-weeks" to "Listening streak · weeks", "consecutive-months" to "Listening streak · months",
        "first-n-scrobbles" to "First to X scrobbles", "fastest-n-scrobbles" to "Fastest to X scrobbles", "oldest-average-listening-time" to "Oldest average listening time", "newest-average-listening-time" to "Newest average listening time",
        "max-single-day" to "Most in one day", "max-single-week" to "Most in one week", "max-single-month" to "Most in one month", "max-rolling-xh" to "Most within X hours", "max-rolling-24h" to "Most within 24 hours", "max-rolling-168h" to "Most within 168 hours",
        "earliest-to-latest" to "Earliest to latest", "latest-to-earliest" to "Latest to earliest", "time-spent-listening" to "Time spent listening", "highest-listening-percentage" to "Percentage of global scrobbles")
    val fields = buildList {
        for (kind in listOf("artist", "album", "track")) {
            val group = kind.replaceFirstChar { it.uppercase() }
            for ((id,label) in listOf("name" to "Exact name", "initial" to "Initial", "includes" to "Name includes", "excludes" to "Name excludes")) add(FilterField("$kind-$id", label, group, if(id in listOf("includes","excludes")) "Comma = OR; semicolon = AND" else ""))
            for ((id,label) in listOf("name-length" to "Name length", "word-count" to "Word count", "scrobble-count" to "Your scrobbles", "rank" to "Library rank", "days-since-last" to "Days since last play") + (if(kind != "track") listOf("track-count" to "Distinct tracks") else emptyList())) {
                add(FilterField("$kind-$id-min", "$label · minimum", group)); add(FilterField("$kind-$id-max", "$label · maximum", group))
            }
            add(FilterField("$kind-first-scrobble-years", "First played in years", group, "2019, 2020"))
            for ((id,label) in listOf("listeners" to "Global listeners", "global-scrobbles" to "Global plays") + (if(kind == "track") listOf("duration" to "Duration (seconds)") else emptyList())) {
                add(FilterField("$kind-$id-min", "$label · minimum", group, detailed=true)); add(FilterField("$kind-$id-max", "$label · maximum", group, detailed=true))
            }
            if(kind == "artist") add(FilterField("artist-tags", "Tags / genres", group, "pop, rock; british", true))
        }
        addAll(listOf(FilterField("last-n-days","Last X days","Time"), FilterField("date-range-start","Start date","Time","YYYY-MM-DD"), FilterField("date-range-end","End date","Time","YYYY-MM-DD"), FilterField("year","Years","Time","2024, 2025"), FilterField("month","Months","Time","1–12, comma separated"), FilterField("day-of-month","Days of month","Time","1, 15, 31"), FilterField("weekday","Weekdays","Time","0 = Sunday … 6 = Saturday"), FilterField("time-of-day-start","Time from","Time","HH:mm"), FilterField("time-of-day-end","Time until","Time","HH:mm")))
        add(FilterField("session-starter-only","Session starters","Time",options=listOf("" to "Off", "use-gap" to "After a long gap")))
        add(FilterField("day-starter-only","Day starters","Time",options=listOf("" to "Off","first-day-literal" to "First of each day","first-day-smart" to "First of day after a long gap")))
        add(FilterField("day-starter-gap-hours","Long gap (hours)","Time","6"))
        add(FilterField("scrobble-order-from","Scrobble sequence · from","Time")); add(FilterField("scrobble-order-to","Scrobble sequence · to","Time"))
    }
}

fun metricText(value: Double, sort: String, zone: ZoneId = ZoneId.systemDefault()): String = when {
    sort in listOf("first-n-scrobbles", "oldest-average-listening-time", "newest-average-listening-time", "earliest-to-latest", "latest-to-earliest", "first-discovery", "latest-play") -> Instant.ofEpochMilli(value.toLong()).atZone(zone).toLocalDate().toString()
    sort == "fastest-n-scrobbles" || sort == "time-spent-listening" -> { val minutes=(value/60000).toLong(); if(minutes<60) "$minutes min" else if(minutes<1440) "${minutes/60}h ${minutes%60}m" else "${minutes/1440}d ${(minutes%1440)/60}h" }
    sort == "highest-listening-percentage" -> "%.5f%%".format(value)
    else -> "%,d".format(value.toLong())
}
