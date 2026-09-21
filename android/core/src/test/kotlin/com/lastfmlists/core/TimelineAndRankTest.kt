package com.lastfmlists.core

import kotlin.test.*
import java.time.*

class TimelineAndRankTest {
    private fun p(track: String,date: String,artist: String="Artist")=Scrobble(artist,"Album",track,Instant.parse(date+"T12:00:00Z").toEpochMilli())
    private val engine=Analytics(listOf(p("Alpha","2023-12-31"),p("Bravo","2024-01-01"),p("Alpha","2024-01-01"),p("Alpha","2024-01-02"),p("Alpha","2024-03-01"),p("Alpha","2024-03-01","Other")),zone=ZoneId.of("UTC"))
    private val row=engine.analyze(Query(limit=0)).rows.first {it.title=="Alpha" && it.artist=="Artist"}
    @Test fun artistAndLengthRanksMatchTheirLinkedLists() {
        val pages=EntityPages(engine)
        for(link in listOf(pages.artistRank(row)!!,pages.nameLength(row))) {
            val linked=engine.analyze(link.query).rows
            assertEquals(row.key,linked[link.rank!!-1].key)
            assertEquals(row.count,link.count);assertEquals(0,link.query.limit)
        }
        assertEquals(1,pages.artistRank(row)!!.rank)
        assertEquals("5",pages.nameLength(row).query.filters["track-name-length-min"])
    }
    @Test fun weeksAreMondayToSundayAndHaveExactListLinks() {
        val weeks=EntityPages(engine).weeks(row)
        assertEquals("2023-12-25",weeks.first().query.filters["date-range-start"])
        assertEquals("2023-12-31",weeks.first().query.filters["date-range-end"])
        weeks.forEach {w ->val rows=engine.analyze(w.query).rows;val index=rows.indexOfFirst {it.key==row.key};assertEquals(if(index<0) null else index+1,w.rank);assertEquals(if(index<0) 0 else rows[index].count,w.count)}
    }
    @Test fun milestoneThresholdUsesWholeLibraryTrackCounts() {
        fun history(n: Int)=List(n*100) {i->p("Track ${i/100}","2024-01-01").copy(timestamp=1704067200000L+i*1000)}
        assertEquals(50,EntityPages(Analytics(history(9))).milestoneTarget)
        val full=Analytics(history(10));assertEquals(100,EntityPages(full).milestoneTarget)
        val r=full.analyze(Query()).rows.first()
        val milestones=EntityPages(full).rankings(r).second.filter {it.query.sort in listOf("first-n-scrobbles","fastest-n-scrobbles")}
        assertEquals(2,milestones.size);assertTrue(milestones.all {it.query.x==100})
        assertTrue(EntityPages(full).milestones(r,25).all {it.query.x==25})
        assertTrue(EntityPages(full).milestones(r,25).all {link ->full.analyze(link.query).rows[link.rank!!-1].key==r.key})
    }
    @Test fun monthlyChartIncludesZeroMonthsAndDoesNotMergeArtists() {
        val series=ListeningTimeline.series(engine,row,LocalDate.parse("2023-12-01"),LocalDate.parse("2024-03-31"),"month")
        assertEquals(listOf(1,2,0,1),series.bars.map {it.count});assertEquals(4,series.bars.sumOf {it.count})
    }
    @Test fun clippingPreservesCountsAcrossResolutions() {
        for(resolution in listOf("day","week","month","year","auto")) {
            val s=ListeningTimeline.series(engine,row,LocalDate.parse("2024-01-02"),LocalDate.parse("2024-03-01"),resolution)
            assertEquals(2,s.bars.sumOf {it.count});assertEquals(LocalDate.parse("2024-01-02"),s.bars.first().start);assertEquals(LocalDate.parse("2024-03-01"),s.bars.last().end)
        }
    }
    @Test fun dailyResolutionIsLimitedToOneCalendarYearIncludingLeapYears() {
        val from=LocalDate.parse("2024-01-01")
        assertTrue(ListeningTimeline.dailyAllowed(from,LocalDate.parse("2024-12-31")))
        assertFalse(ListeningTimeline.dailyAllowed(from,LocalDate.parse("2025-01-01")))
        val s=ListeningTimeline.series(engine,row,from,LocalDate.parse("2025-01-01"),"day")
        assertTrue(s.adjusted);assertNotEquals("day",s.resolution)
        assertFails {ListeningTimeline.series(engine,row,from,from.minusDays(1),"month")}
    }
}
