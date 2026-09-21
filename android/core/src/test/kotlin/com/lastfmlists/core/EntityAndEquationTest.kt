package com.lastfmlists.core

import kotlin.test.*
import java.time.Instant
import java.time.ZoneId

class EntityAndEquationTest {
    private fun play(track: String,date: String,artist: String="Artist")=Scrobble(artist,"Album",track,Instant.parse(date+"T12:00:00Z").toEpochMilli())
    private val engine=Analytics(listOf(play("Alpha","2019-01-01"),play("Beta","2019-01-02"),play("Alpha","2021-02-01"),play("Alpha","2021-02-02"),play("Another","2021-02-03"),play("Alpha","2021-02-04","Other artist")),zone=ZoneId.of("UTC"))
    private val row=engine.analyze(Query(limit=0)).rows.first {it.title=="Alpha" && it.artist=="Artist"}
    @Test fun yearsIncludeEmptyYearsAndMonthsIncludeZeroes() {
        val page=EntityPages(engine).overview(row)
        assertEquals(listOf("2019","2020","2021"),page.years.map {it.label})
        assertEquals(0,page.years[1].count);assertNull(page.years[1].rank)
        val months=EntityPages(engine).months(row,2021)
        assertEquals(12,months.size);assertEquals(2,months[1].count);assertEquals(1,months[1].rank)
    }
    @Test fun periodAndInitialLinksReproduceTheDisplayedRanking() {
        val page=EntityPages(engine).overview(row)
        for(link in page.years+page.initial+EntityPages(engine).months(row,2021)) {
            val rows=engine.analyze(link.query).rows;val index=rows.indexOfFirst {it.key==row.key}
            assertEquals(if(index<0) null else index+1,link.rank)
            assertEquals(if(index<0) 0 else rows[index].count,link.count)
        }
        assertEquals("A",page.initial.query.filters["track-initial"])
        assertEquals(0,page.artistQuery.limit)
        assertEquals(5,page.artistPlays)
    }
    @Test fun albumsWithSameNameStaySeparateAndScrobblesOpenTrackDetails() {
        val album=engine.analyze(Query(type=EntityType.ALBUM,limit=0)).rows.first()
        assertEquals(5,EntityPages(engine).overview(album).row.fullCount)
        val scrobble=engine.analyze(Query(type=EntityType.SCROBBLE)).rows.first()
        assertEquals(EntityType.TRACK,EntityPages(engine).overview(scrobble).row.type)
    }
    @Test fun displayedSpecialRanksRespectCutoffsAndMatchLinkedLists() {
        val groups=EntityPages(engine).rankings(row)
        groups.first.forEach {assertTrue(it.rank!!<=100)};groups.second.forEach {assertTrue(it.rank!!<=10)}
        (groups.first+groups.second).forEach {link ->assertEquals(row.key,engine.analyze(link.query).rows[link.rank!!-1].key)}
        assertFalse(groups.second.any {it.query.sort=="time-spent-listening"})
    }
    @Test fun visualCalculationsPreserveGroupingAndExecute() {
        val plan=listOf(EquationStep(left=Operand.Calculation(Operand.Field("track-scrobble-count"),"/",Operand.Field("artist-scrobble-count")),comparison=">=",right=Operand.Number(".5")))
        val code=EquationPlan.encode(plan)
        val restored=EquationPlan.encode(EquationPlan.decode(code))
        assertEquals(code,restored)
        val rows=engine.analyze(Query(limit=0,equations=code)).rows
        assertEquals(2,rows.size);assertTrue(rows.all {it.title=="Alpha"})
    }
    @Test fun legacyPipelinesRoundTripWithoutChangingResults() {
        val code="filter (track-scrobble-count + 2) * 3 >= 9; sort artist-name desc; unique track-name 2; show artist-rank"
        val restored=EquationPlan.encode(EquationPlan.decode(code))
        assertEquals(engine.analyze(Query(equations=code)),engine.analyze(Query(equations=restored)))
        val quoted="filter track-name = \"semi; colon\""
        assertEquals(quoted,EquationPlan.encode(EquationPlan.decode(quoted)))
    }
    @Test fun incompleteRulesAreRejectedInsteadOfSilentlyReset() {
        assertFails {EquationPlan.encode(listOf(EquationStep(right=Operand.Number(""))))}
        assertFails {EquationPlan.decode("filter track-scrobble-count >=")}
        assertFails {EquationPlan.decode("show unknown-field")}
        assertFails {EquationPlan.decode("unique artist-name 0")}
    }
}
