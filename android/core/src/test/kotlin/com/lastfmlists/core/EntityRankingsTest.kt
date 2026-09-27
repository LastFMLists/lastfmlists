package com.lastfmlists.core

import kotlin.test.*

class EntityRankingsTest {
    @Test fun expandedRankingsIncludePositionsBeyondFormerCutoffs() {
        val history=buildList {
            repeat(105) { index ->
                repeat(2) { play -> add(Scrobble("Artist $index","Album $index","Track $index",1700000000000L+(index*3+play)*86400000L)) }
            }
        }
        val engine=Analytics(history)
        val row=engine.analyze(Query(limit=0)).rows.last()
        val (streaks,other)=EntityPages(engine).rankings(row)
        assertTrue(streaks.any {it.rank!=null && it.rank>100})
        assertTrue(other.any {it.rank!=null && it.rank>10})
    }
}
