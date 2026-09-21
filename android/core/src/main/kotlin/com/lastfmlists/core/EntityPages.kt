package com.lastfmlists.core

import java.time.YearMonth
import java.time.LocalDate
import java.time.DayOfWeek
import java.time.temporal.TemporalAdjusters

data class RankedLink(val label: String,val count: Int,val rank: Int?,val query: Query,val value: Double=count.toDouble(),val entries: Int=0)
data class EntityOverview(val row: ResultRow,val first: Long,val last: Long,val artistPlays: Int,val initial: RankedLink,val years: List<RankedLink>,val artistQuery: Query)

/** Detail rankings always use the complete downloaded library, not the current list's filters. */
class EntityPages(private val engine: Analytics) {
    val milestoneTarget get()=if(engine.stats.getValue(EntityType.TRACK).values.count {it.count>=100}<10) 50 else 100
    fun artistRank(row: ResultRow): RankedLink? {
        if(row.type==EntityType.ARTIST) return null
        val q=Query(type=row.type,limit=0,filters=mapOf("artist-name" to row.sample.artist))
        val result=countRank(engine.filtered(q),row.type,row.key)
        return RankedLink("Among ${row.sample.artist}’s ${row.type.title.lowercase()}",result.count,result.rank,q,entries=result.entries)
    }
    fun nameLength(row: ResultRow): RankedLink {
        val n=row.title.length
        val kind=row.type.name.canonical()
        val q=Query(type=row.type,limit=0,filters=mapOf("$kind-name-length-min" to "$n","$kind-name-length-max" to "$n"))
        val result=countRank(engine.filtered(q),row.type,row.key)
        return RankedLink("Names with $n characters",result.count,result.rank,q,entries=result.entries)
    }
    fun weeks(row: ResultRow): List<RankedLink> {
        fun monday(d: LocalDate)=d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
        val grouped=engine.history.groupBy {monday(engine.date(it).toLocalDate())}
        var week=monday(engine.date(engine.history.first()).toLocalDate())
        val end=monday(engine.date(engine.history.last()).toLocalDate())
        return buildList {while(!week.isAfter(end)) {
            val result=countRank(grouped[week].orEmpty(),row.type,row.key)
            add(RankedLink("$week – ${week.plusDays(6)}",result.count,result.rank,Query(type=row.type,limit=0,filters=mapOf("date-range-start" to "$week","date-range-end" to "${week.plusDays(6)}")),entries=result.entries))
            week=week.plusWeeks(1)
        }}
    }
    fun overview(input: ResultRow): EntityOverview {
        val type=if(input.type==EntityType.SCROBBLE) EntityType.TRACK else input.type
        val key=input.sample.key(type)
        val row=engine.analyze(Query(type=type,limit=0)).rows.first {it.key==key}
        val stat=engine.stats.getValue(type).getValue(key)
        val firstYear=engine.date(engine.history.first()).year
        val lastYear=engine.date(engine.history.last()).year
        val grouped=engine.history.groupBy {engine.date(it).year}
        val years=(firstYear..lastYear).map {year ->
            val result=countRank(grouped[year].orEmpty(),type,key)
            RankedLink(year.toString(),result.count,result.rank,Query(type=type,limit=0,filters=mapOf("year" to year.toString())),entries=result.entries)
        }
        // Unicode code point, not a UTF-16 half-character. Punctuation and digits are retained.
        val initial=row.title.take(row.title.offsetByCodePoints(0,1))
        val initialQuery=Query(type=type,limit=0,filters=mapOf("${type.name.canonical()}-initial" to initial))
        val initialResult=countRank(engine.filtered(initialQuery),type,key)
        return EntityOverview(row,stat.first,stat.last,engine.stats.getValue(EntityType.ARTIST).getValue(row.sample.key(EntityType.ARTIST)).count,
            RankedLink("Names starting with $initial",initialResult.count,initialResult.rank,initialQuery,entries=initialResult.entries),years,
            Query(type=EntityType.TRACK,limit=0,filters=mapOf("artist-name" to row.sample.artist)))
    }
    fun months(row: ResultRow,year: Int): List<RankedLink> {
        val type=row.type; val key=row.sample.key(type)
        val grouped=engine.history.filter {engine.date(it).year==year}.groupBy {engine.date(it).monthValue}
        return (1..12).map {month ->
            val result=countRank(grouped[month].orEmpty(),type,key)
            RankedLink(YearMonth.of(year,month).toString(),result.count,result.rank,Query(type=type,limit=0,filters=mapOf("year" to "$year","month" to "$month")),entries=result.entries)
        }
    }
    fun rankings(row: ResultRow): Pair<List<RankedLink>,List<RankedLink>> {
        val streaks=listOf("consecutive-scrobbles","consecutive-days","consecutive-weeks","consecutive-months")
        val excluded=listOf("scrobbles","earliest-to-latest","latest-to-earliest")+streaks
        fun ranked(sort: String,maxRank: Int): RankedLink? {
            val target=if(sort in listOf("first-n-scrobbles","fastest-n-scrobbles")) milestoneTarget else 10
            val q=Query(type=row.type,sort=sort,limit=0,x=target)
            val rows=engine.analyze(q).rows
            val i=rows.indexOfFirst {it.key==row.key}
            if(i<0 || i>=maxRank) return null
            val match=rows[i]
            if(sort in listOf("time-spent-listening","highest-listening-percentage") && match.value<=0) return null
            val label=Catalog.sorts.first {it.first==sort}.second.replace("X","$target")
            return RankedLink(label,match.count,i+1,q,match.value,rows.size)
        }
        return streaks.mapNotNull {ranked(it,100)} to Catalog.sorts.map {it.first}.filter {it !in excluded}.mapNotNull {ranked(it,if(it in listOf("first-n-scrobbles","fastest-n-scrobbles")) Int.MAX_VALUE else 10)}
    }
    fun milestones(row: ResultRow,target: Int): List<RankedLink> = listOf("first-n-scrobbles","fastest-n-scrobbles").mapNotNull {sort ->
        val q=Query(type=row.type,sort=sort,limit=0,x=target.coerceAtLeast(1))
        val rows=engine.analyze(q).rows;val i=rows.indexOfFirst {it.key==row.key}
        if(i<0) null else RankedLink(Catalog.sorts.first {it.first==sort}.second.replace("X",target.toString()),rows[i].count,i+1,q,rows[i].value,rows.size)
    }
    private data class CountRank(val count: Int,val rank: Int?,val entries: Int)
    private fun countRank(plays: List<Scrobble>,type: EntityType,key: String): CountRank {
        // Stable sort gives the same ordinal tie ordering as the main analytics engine.
        val counts=plays.groupingBy {it.key(type)}.eachCount().entries.sortedByDescending {it.value}
        val index=counts.indexOfFirst {it.key==key}
        return if(index<0) CountRank(0,null,counts.size) else CountRank(counts[index].value,index+1,counts.size)
    }
}
