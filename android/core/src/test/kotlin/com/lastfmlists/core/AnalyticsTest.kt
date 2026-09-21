package com.lastfmlists.core

import kotlin.test.*
import java.time.*

class AnalyticsTest {
    private fun play(artist: String, track: String, time: String, album: String = "Album")=Scrobble(artist,album,track,Instant.parse(time).toEpochMilli())
    private val data=listOf(play("A","One","2025-01-01T01:00:00Z"),play("A","One","2025-01-01T02:00:00Z"),play("B","Two","2025-01-01T03:00:00Z"),play("A","One","2025-01-02T01:00:00Z"),play("A","Three","2025-01-03T01:00:00Z"))
    private fun engine(d: List<Scrobble> = data, zone: String = "UTC")=Analytics(d,zone=ZoneId.of(zone))
    @Test fun groupsAndArtistCap() {
        assertEquals(listOf(3,1,1),engine().analyze(Query()).rows.map { it.count })
        val result=engine().analyze(Query(maxPerArtist=1,limit=2))
        assertEquals(listOf("A","B"),result.rows.map { it.artist })
        assertEquals(5,result.matchingScrobbles)
    }
    @Test fun filtersRetainOriginalSequenceForConsecutivePlays() {
        val result=engine().analyze(Query(sort="consecutive-scrobbles",filters=mapOf("artist-name" to "A")))
        assertEquals(2.0,result.rows.first().value)
    }
    @Test fun datesUseLocalCalendarAndInclusiveEnd() {
        val result=engine(zone="America/New_York").analyze(Query(filters=mapOf("date-range-start" to "2024-12-31","date-range-end" to "2024-12-31")))
        assertEquals(3,result.matchingScrobbles)
    }
    @Test fun overnightTimeRange() {
        assertEquals(4,engine().analyze(Query(filters=mapOf("time-of-day-start" to "23:00","time-of-day-end" to "02:00"))).matchingScrobbles)
    }
    @Test fun dayStreakSurvivesDaylightSaving() {
        val d=listOf(play("A","One","2025-03-08T17:00:00Z"),play("A","One","2025-03-09T16:00:00Z"),play("A","One","2025-03-10T16:00:00Z"))
        assertEquals(3.0,engine(d,"America/New_York").analyze(Query(sort="consecutive-days")).rows.single().value)
    }
    @Test fun weeklyStreakCrossesYearBoundary() {
        val d=listOf(play("A","One","2024-12-23T12:00:00Z"),play("A","One","2024-12-30T12:00:00Z"),play("A","One","2025-01-06T12:00:00Z"))
        assertEquals(3.0,engine(d).analyze(Query(sort="consecutive-weeks")).rows.single().value)
    }
    @Test fun fastestToXMatchesWebsiteFirstMilestoneSemantics() {
        assertEquals(3600000.0,engine().analyze(Query(sort="fastest-n-scrobbles",x=2)).rows.single().value)
    }
    @Test fun equationsApplyOrderUniqueAndShownFields() {
        val result=engine().analyze(Query(equations="filter artist-name = 'A'; sort track-name desc; unique track-name; show artist-rank"))
        assertEquals(listOf("Three","One"),result.rows.map { it.title })
        assertEquals("1.0",result.rows.first().extras["artist-rank"])
    }
    @Test fun equationsHandleArithmeticAndRejectBadInput() {
        assertEquals(3,engine().analyze(Query(equations="track-scrobble-count * 2 >= 6")).matchingScrobbles)
        assertFailsWith<IllegalArgumentException> { engine().analyze(Query(equations="sort unknown")) }
        assertEquals(0,engine().analyze(Query(equations="1 / 0 > 1")).matchingScrobbles)
    }
    @Test fun metadataFiltersNeverTreatMissingValuesAsZero() {
        assertEquals(0,engine().analyze(Query(filters=mapOf("track-duration-max" to "100"))).matchingScrobbles)
        val e=Analytics(data,mapOf((EntityType.TRACK to data[0].key(EntityType.TRACK)) to Metadata(durationMs=60000)))
        assertEquals(3,e.analyze(Query(filters=mapOf("track-duration-max" to "100"))).matchingScrobbles)
    }
    @Test fun identicalAlbumNamesFromDifferentArtistsRemainSeparate() {
        val e=Analytics(data,data.associate { (EntityType.TRACK to it.key(EntityType.TRACK)) to Metadata(durationMs=1000) })
        assertEquals(2,e.analyze(Query(type=EntityType.ALBUM,sort="time-spent-listening")).rows.size)
    }
    @Test fun invalidFiltersAreVisibleErrors() {
        assertFailsWith<IllegalArgumentException> { engine().analyze(Query(filters=mapOf("month" to "13"))) }
        assertFailsWith<IllegalArgumentException> { engine().analyze(Query(filters=mapOf("date-range-start" to "not a date"))) }
    }
    @Test fun semicolonInsideQuotedNameIsNotACommandSeparator() {
        val d=listOf(play("A; B","One","2025-01-01T01:00:00Z"))
        assertEquals(1,engine(d).analyze(Query(equations="artist-name = 'A; B'")).matchingScrobbles)
    }
}
