package com.lastfmlists.app

import androidx.compose.ui.test.*
import androidx.compose.ui.geometry.Offset
import com.lastfmlists.core.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.*
import org.junit.Assert.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class OfflineJourneyTest {
    @get:Rule val compose=createEmptyComposeRule()
    private lateinit var scenario: ActivityScenario<MainActivity>
    private lateinit var app: ListsApplication
    @Before fun before() {
        app=ApplicationProvider.getApplicationContext()
        app.prefs.edit().clear().commit()
        scenario=ActivityScenario.launch(MainActivity::class.java)
    }
    @After fun after() {scenario.close()}
    private fun loadDemo() {
        compose.onNodeWithText("Try a sample library").performScrollTo().performClick()
        compose.waitUntil(30000) {compose.onAllNodesWithText("Sample library").fetchSemanticsNodes().isNotEmpty()}
        compose.waitForIdle()
    }
    @Test fun demoFiltersAndGamesWorkWithoutNetwork() {
        loadDemo()
        compose.onNodeWithContentDescription("Edit filters").performClick()
        compose.onNodeWithText("List settings").assertIsDisplayed()
        compose.onNodeWithText("Apply filters").performClick()
        compose.onNodeWithText("Games",useUnmergedTree=false).performClick()
        compose.onNodeWithText("Higher or Lower").performClick()
        compose.waitUntil(30000) {compose.onAllNodesWithText("Which have you scrobbled more?").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("Which have you scrobbled more?").assertIsDisplayed()
    }
    @Test fun backgroundDownloadsNeedExplicitConsentAndCancelLeavesThemOff() {
        loadDemo();compose.onNodeWithText("Settings").performClick()
        compose.onNodeWithText("Background downloads").performScrollTo()
        assertFalse(app.prefs.getBoolean("background",false))
        compose.onAllNodes(isToggleable()).onFirst().performClick()
        compose.onNodeWithText("Allow background downloads?").assertIsDisplayed()
        compose.onNodeWithText("Keep foreground only").performClick()
        assertFalse(app.prefs.getBoolean("background",false))
    }
    @Test fun savedDemoRestoresAfterActivityRecreation() {
        loadDemo();scenario.recreate()
        compose.waitUntil(30000) {compose.onAllNodesWithText("Sample library").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("Sample library").assertIsDisplayed()
    }
    @Test fun switchingListStartsAtTheTop() {
        loadDemo()
        compose.onNodeWithTag("results-main").performScrollToIndex(20)
        compose.onNodeWithText("Albums").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("01").assertIsDisplayed()
    }
    @Test fun activeFilterSummaryOpensTheExactFilterAndDisplayHoldsViewOptions() {
        loadDemo()
        scenario.onActivity {activity ->androidx.lifecycle.ViewModelProvider(activity)[MainViewModel::class.java].updateQuery(Query(filters=mapOf("track-includes" to "Hidden")))}
        compose.waitUntil(30000) {compose.onAllNodes(hasText("Name includes: Hidden",substring=true)).fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithContentDescription("Show all active filters").performClick()
        compose.onNodeWithText("Name includes: Hidden").performClick()
        compose.onNodeWithText("Track").assertIsDisplayed()
        compose.onNodeWithText("Hidden").assertIsDisplayed()
        compose.onNodeWithText("Display").performClick()
        compose.onNodeWithText("View").assertIsDisplayed()
        compose.onNodeWithText("Show full-library counts and ranks").assertIsDisplayed()
    }
    @Test fun entityInitialLinkOpensAnUnlimitedFilteredList() {
        loadDemo();compose.onNodeWithText("Hidden Place").performClick()
        compose.waitUntil(30000) {compose.onAllNodesWithText("High placements").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithText("Show all lists").performScrollTo().performClick()
        compose.onNodeWithTag("entity-page").performScrollToIndex(22)
        compose.onNodeWithText("Other rankings · top 10").performScrollTo().performClick()
        compose.waitUntil(30000) {compose.onAllNodesWithText("Names starting with H").fetchSemanticsNodes().isNotEmpty()}
        compose.onNodeWithTag("entity-page").performScrollToNode(hasText("Names starting with H"))
        compose.onAllNodesWithText("Names starting with H").onLast().performClick()
        compose.onNodeWithText("Back to list").assertDoesNotExist()
        scenario.onActivity {activity ->
            val vm=androidx.lifecycle.ViewModelProvider(activity)[MainViewModel::class.java]
            assertEquals("H",vm.left.filters["track-initial"]);assertEquals(0,vm.left.limit)
        }
    }
    @Test fun visualEquationExampleAppliesAndResetClearsIt() {
        loadDemo();compose.onNodeWithContentDescription("Edit filters").performClick()
        compose.onNode(hasTextExactly("Equations") and isSelectable()).performScrollTo().performClick()
        compose.onNodeWithText("How to use rules").performScrollTo().performClick()
        compose.onNodeWithText("Tracks with at least 10 plays").performScrollTo().performClick()
        compose.onNodeWithText("Apply filters").performClick()
        scenario.onActivity {activity ->assertTrue(androidx.lifecycle.ViewModelProvider(activity)[MainViewModel::class.java].left.equations.contains("track-scrobble-count"))}
        compose.onNodeWithContentDescription("Edit filters").performClick()
        compose.onNode(hasTextExactly("Equations") and isSelectable()).performScrollTo().performClick()
        compose.onAllNodesWithText("Reset").onLast().performClick()
        compose.onNodeWithText("Apply filters").performClick()
        scenario.onActivity {activity ->assertEquals("",androidx.lifecycle.ViewModelProvider(activity)[MainViewModel::class.java].left.equations)}
    }
    @Test fun typedUsernameCasingSurvivesAccountSwitching() {
        scenario.onActivity {activity ->
            val vm=androidx.lifecycle.ViewModelProvider(activity)[MainViewModel::class.java]
            vm.chooseAccount("Armin",false);assertEquals("Armin",vm.displayName)
            vm.chooseAccount("someoneelse",false);vm.chooseAccount("armin",false)
            assertEquals("Armin",vm.displayName);assertEquals("armin",vm.username)
        }
    }
    @Test fun fillOptionsOnlyAppearAfterChoosingTheGame() {
        loadDemo();compose.onNodeWithText("Games").performClick()
        compose.onNodeWithText("Hard mode").assertDoesNotExist()
        compose.onNodeWithText("Fill the List").performScrollTo().performClick()
        compose.onNodeWithText("Answer types").assertIsDisplayed()
        compose.onNodeWithText("Start game").performClick()
        compose.waitUntil(30000) {compose.onAllNodesWithText("Name an answer").fetchSemanticsNodes().isNotEmpty()}
    }
    @Test fun historyRestoresExactQueriesAndIsAccountScoped() {
        loadDemo()
        val q=Query(EntityType.TRACK,"first-n-scrobbles",50,0,2,mapOf("year" to "2024"),"filter track-scrobble-count >= 10")
        val s=ListSnapshot(q,Query(type=EntityType.ARTIST),true)
        val history=ListHistory(app.prefs)
        history.record("sample-library",s)
        assertEquals(s,history.read("sample-library").first());assertTrue(history.read("other").isEmpty())
        scenario.onActivity {activity ->val vm=androidx.lifecycle.ViewModelProvider(activity)[MainViewModel::class.java];vm.restoreList(s);assertEquals(q,vm.left);assertEquals(s.right,vm.right);assertTrue(vm.comparison)}
    }
    @Test fun supportCountsDistinctListsAndHideForeverPersists() {
        loadDemo()
        fun visit(q: Query) {
            scenario.onActivity {a ->androidx.lifecycle.ViewModelProvider(a)[MainViewModel::class.java].updateQuery(q)}
            compose.waitUntil(30000) {var ready=false;scenario.onActivity {a ->ready=!androidx.lifecycle.ViewModelProvider(a)[MainViewModel::class.java].calculating};ready}
            scenario.onActivity {a ->androidx.lifecycle.ViewModelProvider(a)[MainViewModel::class.java].listViewed()}
        }
        repeat(5) {visit(Query())}
        assertEquals(1,app.prefs.getStringSet("viewedListKeys",emptySet())!!.size)
        listOf("separate-days","separate-months","max-single-day","consecutive-days").forEach {visit(Query(sort=it))}
        compose.onNodeWithText("Don't show again").assertIsDisplayed().performClick()
        assertTrue(app.prefs.getBoolean("hideSupportPrompt",false))
        scenario.recreate();compose.onNodeWithText("Don't show again").assertDoesNotExist()
    }
    @Test fun orderingDragMovesDownAndBackUpWithoutLosingThePointer() {
        loadDemo()
        val rows=Analytics(listOf("Order A","Order B","Order C").mapIndexed {i,t->Scrobble("Artist","Album",t,1700000000000L+i)}).analyze(Query()).rows
        scenario.onActivity {a ->val vm=androidx.lifecycle.ViewModelProvider(a)[MainViewModel::class.java];vm.tab=1;vm.game.mode="Put Them In Order";vm.game.puzzle=Games.Puzzle("Test",Query(),rows,"Test");vm.game.ordered=rows}
        compose.waitForIdle()
        fun drag(from: String,to: String,delta: Float) {
            val start=compose.onNodeWithContentDescription("Hold to drag $from").fetchSemanticsNode().boundsInRoot.center
            val end=compose.onNodeWithContentDescription("Hold to drag $to").fetchSemanticsNode().boundsInRoot.center+Offset(0f,delta)
            compose.onRoot().performTouchInput {down(start)}
            compose.mainClock.advanceTimeBy(300)
            compose.onNodeWithTag("order-board").assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription,"Dragging"))
            compose.onRoot().performTouchInput {advanceEventTime(800);moveTo(end,delayMillis=200)}
            compose.waitForIdle()
            compose.onRoot().performTouchInput {up()}
            compose.waitForIdle()
        }
        drag("Order A","Order C",10f)
        scenario.onActivity {a ->assertEquals("Order A",androidx.lifecycle.ViewModelProvider(a)[MainViewModel::class.java].game.ordered.last().title)}
        drag("Order A","Order B",-10f)
        scenario.onActivity {a ->assertEquals("Order A",androidx.lifecycle.ViewModelProvider(a)[MainViewModel::class.java].game.ordered.first().title)}
    }
}

