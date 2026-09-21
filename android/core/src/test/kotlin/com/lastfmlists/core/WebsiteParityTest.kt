package com.lastfmlists.core

import kotlin.test.*
import java.time.ZoneId

class WebsiteParityTest {
    @Test fun nativeRankingsMatchSixtyWebsiteQueries() {
        fun resource(name: String)=javaClass.getResourceAsStream("/$name")!!.bufferedReader().readLines().filter {it.isNotEmpty()}
        val history=resource("website-history.tsv").map {line -> val c=line.split('\t');Scrobble(c[0],c[1],c[2],c[3].toLong())}
        val metadata=buildMap {for(type in listOf(EntityType.ARTIST,EntityType.ALBUM,EntityType.TRACK)) history.forEach {put(type to it.key(type),Metadata(1000,10000,180000))}}
        val engine=Analytics(history,metadata,ZoneId.of("UTC"))
        val fixtures=resource("website-results.tsv").map {it.split('\t')}.groupBy {it[0] to it[1]}
        assertEquals(60,fixtures.size)
        fixtures.forEach { (query,expected) ->
            val (type,sort)=query
            val actual=engine.analyze(Query(type=EntityType.valueOf(type.uppercase()),sort=sort,x=3,limit=0)).rows
            assertEquals(expected.size,actual.size,"$type / $sort: entity count")
            expected.forEach {entry -> val row=actual.single {it.title==entry[2] && it.artist==entry[3]};assertEquals(entry[4].toDouble(),row.value,0.00001,"$type / $sort / ${entry[2]}")}
            expected.zip(actual).forEachIndexed {index,(entry,row) -> assertEquals(entry[4].toDouble(),row.value,0.00001,"$type / $sort: rank ${index+1}")}
        }
    }
    @Test fun csvRoundTripPreservesQuotedNamesNewlinesAndRepeatedPlays() {
        val plays=listOf(Scrobble("A; B","","\"Song\"\nTwo",1700000000000),Scrobble("A; B","","\"Song\"\nTwo",1700000000000))
        val result=Csv.read(Csv.write("listener",plays))
        assertEquals("listener",result.username);assertEquals(plays,result.plays)
    }
    @Test fun answersAcceptAccentsAndTyposButNotShortPrefixes() {
        assertTrue(Games.matches("motorhead","Motörhead"));assertTrue(Games.matches("Karma Polixe","Karma Police"));assertFalse(Games.matches("Karma Poli","Karma Police"));assertTrue(Games.matches("Karma Poli","Karma Police",true))
    }
    @Test fun nonLatinGlossIsAcceptedButReleaseQualifiersAreNotAnswers() {
        assertTrue(Games.matches("complexity","복합성 (Complexity)"))
        assertFalse(Games.matches("special edition","桜月 (Special Edition)"))
    }
    @Test fun largeHistoryRetainsEveryPlay() {
        val history=List(100000) {i -> Scrobble("Artist ${i%100}","Album ${i%300}","Track ${i%1000}",1700000000000L+i*180000L)}
        val result=Analytics(history,zone=ZoneId.of("UTC")).analyze(Query(type=EntityType.ARTIST,limit=0))
        assertEquals(100000,result.matchingScrobbles);assertEquals(100,result.rows.size);assertTrue(result.rows.all {it.count==1000})
    }
}
