package com.lastfmlists.core

import java.time.LocalDate
import java.time.DayOfWeek
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

data class ListeningBar(val start: LocalDate,val end: LocalDate,val count: Int)
data class ListeningSeries(val resolution: String,val bars: List<ListeningBar>,val adjusted: Boolean)

object ListeningTimeline {
    fun dailyAllowed(start: LocalDate,end: LocalDate)=!end.isAfter(start.plusYears(1).minusDays(1))
    fun series(engine: Analytics,row: ResultRow,start: LocalDate,end: LocalDate,requested: String): ListeningSeries {
        require(!end.isBefore(start)) {"End date must be on or after start date"}
        require(ChronoUnit.YEARS.between(start,end)<200) {"Choose a range shorter than 200 years"}
        val days=ChronoUnit.DAYS.between(start,end)+1
        val auto=when {days<=90 -> "day";days<=730 -> "week";days<=7300 -> "month";else -> "year"}
        val resolution=if(requested=="auto" || requested=="day" && !dailyAllowed(start,end)) auto else requested
        require(resolution in listOf("day","week","month","year"))
        fun bucket(d: LocalDate)=when(resolution) {"week"->d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));"month"->d.withDayOfMonth(1);"year"->d.withDayOfYear(1);else->d}
        fun next(d: LocalDate)=when(resolution) {"week"->d.plusWeeks(1);"month"->d.plusMonths(1);"year"->d.plusYears(1);else->d.plusDays(1)}
        val counts=engine.history.asSequence().filter {it.key(row.type)==row.key}.map {engine.date(it).toLocalDate()}.filter {it>=start && it<=end}.groupingBy {bucket(it)}.eachCount()
        val bars=buildList {var d=bucket(start);while(d<=end) {val after=next(d);add(ListeningBar(maxOf(d,start),minOf(after.minusDays(1),end),counts[d] ?: 0));d=after}}
        return ListeningSeries(resolution,bars,requested!="auto" && requested!=resolution)
    }
}
