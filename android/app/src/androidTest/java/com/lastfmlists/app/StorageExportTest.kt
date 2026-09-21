package com.lastfmlists.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.lastfmlists.core.*
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream

@RunWith(AndroidJUnit4::class)
class StorageExportTest {
    private val context=ApplicationProvider.getApplicationContext<Context>()
    private lateinit var store: LibraryStore
    private val name="checkpoint-test.db"
    @Before fun before() {context.deleteDatabase(name);store=LibraryStore(context,name)}
    @After fun after() {store.close();context.deleteDatabase(name)}
    @Test fun checkpointSurvivesRestartAndPreservesDuplicatePlays() {
        val s=Scrobble("Artist","Album","Song",1700000000000)
        store.ensure("listener");val snapshot=store.begin("listener")
        store.savePage("listener",1,listOf(s,s),2)
        assertEquals(2,store.history("listener").size)
        store.close();store=LibraryStore(context,name)
        assertEquals(snapshot.until,store.begin("listener").until)
        assertEquals(2,store.account("listener")!!.nextPage)
        store.savePage("listener",2,listOf(s.copy(timestamp=s.timestamp-1000)),2)
        store.finish("listener")
        assertEquals(3,store.history("listener").size)
        assertFalse(store.account("listener")!!.pending)
        assertTrue(store.history("another-user").isEmpty())
    }
    @Test fun incrementalSyncReplacesOverlapWithoutDroppingIdenticalSecondPlays() {
        val s=Scrobble("Artist","Album","Song",1700000000000)
        store.importHistory("listener",listOf(s.copy(timestamp=s.timestamp-1000),s,s))
        store.begin("listener")
        store.savePage("listener",1,listOf(s.copy(timestamp=s.timestamp+1000),s,s),1)
        store.finish("listener")
        assertEquals(4,store.history("listener").size)
    }
    @Test fun metadataAndHistoryAreAccountScoped() {
        val s=Scrobble("Artist","Album","Song",1700000000000)
        store.importHistory("one",listOf(s));store.importHistory("two",listOf(s))
        store.saveMetadata("one",EntityType.TRACK,s.key(EntityType.TRACK),Metadata(durationMs=120000))
        assertTrue(store.metadata("two").isEmpty())
        store.deleteAccount("one");assertEquals(1,store.history("two").size);assertTrue(store.metadata("one").isEmpty())
    }
    @Test fun nativePngRendererCreatesReadableNonEmptyImage() {
        val engine=Analytics(listOf(Scrobble("Artist","Album","Song",1700000000000)))
        val q=Query();val result=Exporter.render("listener",listOf(q to engine.analyze(q).rows),false,false,true)
        assertEquals(720,result.width);assertTrue(result.height>200);result.recycle()
    }
}
