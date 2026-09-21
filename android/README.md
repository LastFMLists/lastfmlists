# lastfmlists for Android

Native Kotlin / Jetpack Compose Android preview, developed on the `android-app` branch. Android 8.0 (API 26) or newer; phones and tablets. The website remains independently deployable. iOS is deferred.

## Features

- Download public Last.fm listening history by username, save each page locally, resume interrupted downloads, and incrementally refresh saved history.
- Offline artist, album, track and scrobble lists, website ranking modes, filters, equations and two-list comparison. Comparisons show both panels on phones and tablets; portrait phones suggest rotating for wider columns.
- Static charts, PNG lists/charts and artwork grids with Save on device or Share, and CSV history import/export. Race charts and GIF export were removed in 0.2.
- Higher or Lower, Put in Order and Fill the List using saved history, with touch controls, haptics and local records. Ordering supports long-press dragging and accessible move buttons.
- Optional metadata downloads for tags, duration and global statistics. Unavailable data is never silently treated as zero.
- Light/dark/system appearance, an illustrative sample library, and separate saved accounts.
- History downloads stay in the foreground by default. An explicit consent dialog enables WorkManager downloads with a progress notification, pause action and Wi-Fi-only default. This continues requested downloads; it is not a periodic automatic refresh.
- No advertisements or analytics SDKs. A voluntary Ko-fi link appears in preview builds and a dismissible support prompt is rate-limited.

Preview 0.4 prioritizes meaningful time and streak highlights, collapses long detail sections, supports editable milestones, and links nonempty graph bars to their lists. It also adds a numbered graph axis, faster compact ordering, a clearer list toolbar, native Sharesheet previews and saves, refreshed Last.fm profile images, and a standard Material support dialog. Equations retain their visual editor, nested calculations, examples and optional advanced syntax. See [WEB-PORT-NOTES.md](WEB-PORT-NOTES.md) for the complete 0.2–0.4 web implementation contract. The website has not been modified.

## Build and test

Install JDK 17 and Android SDK platform 36, then set `ANDROID_HOME` or create an untracked `local.properties` containing `sdk.dir=...`.

```sh
cd android
./gradlew :core:test :app:lintDebug :app:assembleDebug
./gradlew :app:connectedDebugAndroidTest  # running emulator or USB-debugging device
```

On Windows use `gradlew.bat`. The debug APK is `app/build/outputs/apk/debug/app-debug.apk`. It uses application ID `com.lastfmlists.app.debug`; release builds use `com.lastfmlists.app`. The Gradle wrapper is checked in. GitHub Actions builds the preview and uploads its APK on Android branch pushes and pull requests.

The public Last.fm API key from the website is packaged in `app/src/main/assets/lastfm-key.txt`. It is not an authentication secret and cannot be kept secret inside an APK. Review the key's ownership and usage limits before distribution. No Last.fm password is requested.

## Structure and correctness

`core` contains the platform-independent data model, analysis engine, safe equation parser, CSV parser and game generation. `app` contains Compose UI, SQLite storage, HTTP requests, WorkManager and native export rendering.

SQLite commits pages together with their resume checkpoints. An incremental download replaces the timestamp overlap only when complete, preserving legitimate duplicate plays at the same second. A fixed end timestamp keeps pagination stable against new scrobbles. Downloaded history stays available while offline; remote edits to old scrobbles require removing and re-downloading the account. Imported CSVs are separate offline snapshots, not refreshable Last.fm accounts.

`tools/reference-fixtures.mjs` runs the existing website JavaScript in an isolated Node VM to regenerate the committed reference fixtures. The JVM tests compare 60 ranking queries across artists, albums and tracks, alongside edge cases for calendar boundaries, equations, missing metadata, duplicate plays, CSV quoting, answer matching and a 100,000-play library. Instrumented tests exercise restart persistence, incremental overlap, account isolation, PNG rendering, consent dismissal and offline UI navigation.

Dates use the device's local calendar. The Android engine intentionally keeps identically named albums by different artists separate when aggregating duration. Game round selection is adapted for native play; the tests do not claim identical random rounds to the website.

## Preview limits and release work

- This is a debug-signed preview, not a Play Store release. Test the real Pixel 9, large real histories, Android background restrictions and accessibility before publishing. Current emulator coverage is API 35; the supported API range has not all been exercised.
- Artwork becomes available offline after it is fetched and cached; it is not permanently archived with every scrobble. Metadata downloads currently require the app to stay open.
- Android may stop long-running downloads; completed pages resume on the next request. Wi-Fi-only requests may wait until an unmetered connection is available.
- Export limits protect phone memory: lists up to 500 rows and artwork grids up to 10×10. The UI explains these bounds. Large exports and very large libraries need physical-device testing.
- Imported CSV history and downloaded history are separate libraries. Export CSV before removing a library if you want to retain a portable backup. Automatic cloud/device-transfer backup is disabled.
- Complete release signing, privacy-policy hosting, store listing, content rating, account setup and required testing before public release. Signing credentials must stay outside the repository.
- External tipping is disabled in release builds by default. After verifying the actual Ko-fi offering and applicable store requirements, it can be enabled with `-PexternalTipsEnabled=true`. Every feature remains free regardless of donations.

