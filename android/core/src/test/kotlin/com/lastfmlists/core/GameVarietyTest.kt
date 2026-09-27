package com.lastfmlists.core

import kotlin.random.Random
import kotlin.test.*

class GameVarietyTest {
    private val history=buildList {
        repeat(30) { artist ->
            repeat(12+artist*2) { play ->
                add(Scrobble("Artist $artist","Album $artist","Track $artist",1700000000000L+play*86400000L+artist*1000L))
            }
        }
    }

    @Test fun higherOrLowerDoesNotRepeatAnImmediatePair() {
        val games=Games(Analytics(history),Random(42))
        var previous=emptySet<String>()
        repeat(15) { round ->
            val keys=games.pair(EntityType.ARTIST,round).map {it.key}.toSet()
            assertEquals(2,keys.size)
            if(previous.isNotEmpty()) assertNotEquals(previous,keys)
            previous=keys
        }
    }

    @Test fun fillTheListChangesPromptWhenSeveralListsAreAvailable() {
        val games=Games(Analytics(history),Random(9))
        val first=games.fill(setOf(EntityType.ARTIST),setOf("Time"))
        val second=games.fill(setOf(EntityType.ARTIST),setOf("Time"))
        assertNotNull(first)
        assertNotNull(second)
        assertNotEquals(first.prompt,second.prompt)
    }
}
