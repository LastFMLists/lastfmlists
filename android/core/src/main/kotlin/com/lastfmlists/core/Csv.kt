package com.lastfmlists.core

/** Quoted CSV/semicolon import, including the website's Date#username format. */
object Csv {
    data class Import(val username: String,val plays: List<Scrobble>)
    fun read(text: String): Import {
        val source=text.removePrefix("\uFEFF")
        val delimiter=if(source.lineSequence().firstOrNull()?.contains(';')==true) ';' else ','
        val rows=mutableListOf<List<String>>(); val row=mutableListOf<String>(); val cell=StringBuilder(); var quoted=false; var i=0
        while(i<source.length) {
            val c=source[i]
            when {
                c=='"' && quoted && source.getOrNull(i+1)=='"' -> { cell.append('"'); i++ }
                c=='"' -> quoted=!quoted
                c==delimiter && !quoted -> { row.add(cell.toString()); cell.clear() }
                c=='\n' && !quoted -> { row.add(cell.toString().trimEnd('\r')); cell.clear(); if(row.any { it.isNotBlank() }) rows.add(row.toList()); row.clear() }
                else -> cell.append(c)
            }
            i++
        }
        require(!quoted) { "The CSV contains an unclosed quote" }
        if(cell.isNotEmpty() || row.isNotEmpty()) { row.add(cell.toString().trimEnd('\r')); rows.add(row.toList()) }
        require(rows.isNotEmpty()) { "The CSV is empty" }
        val headers=rows.first().map { it.trim().canonical() }
        val dateIndex=headers.indexOfFirst { it=="date" || it=="timestamp" || it.startsWith("date#") }
        val artist=headers.indexOf("artist"); val album=headers.indexOf("album"); val track=headers.indexOf("track")
        require(dateIndex>=0 && artist>=0 && track>=0) { "Expected Artist, Album, Track and Date columns" }
        val username=headers[dateIndex].substringAfter('#',"").ifBlank { "imported-library" }
        val plays=rows.drop(1).mapIndexed { index,values ->
            val raw=values.getOrNull(dateIndex)?.trim()?.toLongOrNull() ?: error("Invalid timestamp on CSV row ${index+2}")
            val timestamp=if(raw<100000000000L) raw*1000 else raw
            require(timestamp>0) { "Invalid timestamp on CSV row ${index+2}" }
            val a=values.getOrNull(artist)?.trim().orEmpty(); val t=values.getOrNull(track)?.trim().orEmpty()
            require(a.isNotEmpty() && t.isNotEmpty()) { "Missing artist or track on CSV row ${index+2}" }
            Scrobble(a,values.getOrNull(album)?.trim().orEmpty(),t,timestamp)
        }
        require(plays.isNotEmpty()) { "No scrobbles in the CSV" }
        return Import(username,plays)
    }
    fun write(username: String,plays: List<Scrobble>): String = buildString {
        append("Artist;Album;Track;Date#").append(username).append('\n')
        fun quote(s: String)="\""+s.replace("\"","\"\"")+"\""
        plays.forEach { s -> append(listOf(quote(s.artist),quote(s.album),quote(s.track),s.timestamp.toString()).joinToString(";")).append('\n') }
    }
}
