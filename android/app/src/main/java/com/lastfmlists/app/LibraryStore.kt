package com.lastfmlists.app

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.lastfmlists.core.*
import org.json.JSONArray
import org.json.JSONObject

data class Account(val name: String,val avatar: String="",val lastSync: Long=0,val from: Long=0,val until: Long=0,val nextPage: Int=1,val totalPages: Int=0) { val pending get()=until>0 }

/** Pages and their checkpoints commit together. No timestamp-only deduplication: repeated plays are preserved. */
class LibraryStore(context: Context,name: String="library.db"): SQLiteOpenHelper(context,name,null,1) {
    init { setWriteAheadLoggingEnabled(true) }
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE accounts(name TEXT PRIMARY KEY,avatar TEXT NOT NULL DEFAULT '',last_sync INTEGER NOT NULL DEFAULT 0,start INTEGER NOT NULL DEFAULT 0,until INTEGER NOT NULL DEFAULT 0,next_page INTEGER NOT NULL DEFAULT 1,total_pages INTEGER NOT NULL DEFAULT 0)")
        db.execSQL("CREATE TABLE plays(id INTEGER PRIMARY KEY,account TEXT NOT NULL,artist TEXT NOT NULL,album TEXT NOT NULL,track TEXT NOT NULL,time INTEGER NOT NULL,image TEXT NOT NULL)")
        db.execSQL("CREATE INDEX plays_account_time ON plays(account,time)")
        db.execSQL("CREATE TABLE pages(account TEXT NOT NULL,page INTEGER NOT NULL,position INTEGER NOT NULL,artist TEXT NOT NULL,album TEXT NOT NULL,track TEXT NOT NULL,time INTEGER NOT NULL,image TEXT NOT NULL,PRIMARY KEY(account,page,position))")
        db.execSQL("CREATE TABLE metadata(account TEXT NOT NULL,kind TEXT NOT NULL,entity_key TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(account,kind,entity_key))")
    }
    override fun onUpgrade(db: SQLiteDatabase,oldVersion: Int,newVersion: Int) { error("No destructive migrations allowed") }
    private inline fun transaction(block: (SQLiteDatabase)->Unit) { val db=writableDatabase; db.beginTransaction(); try { block(db); db.setTransactionSuccessful() } finally { db.endTransaction() } }
    fun accounts(): List<Account> = readableDatabase.rawQuery("SELECT name,avatar,last_sync,start,until,next_page,total_pages FROM accounts ORDER BY name",null).use { c -> buildList { while(c.moveToNext()) add(Account(c.getString(0),c.getString(1),c.getLong(2),c.getLong(3),c.getLong(4),c.getInt(5),c.getInt(6))) } }
    fun account(name: String)=accounts().firstOrNull { it.name==name.canonical() }
    fun ensure(name: String,avatar: String="") { writableDatabase.insertWithOnConflict("accounts",null,ContentValues().apply { put("name",name.canonical()); put("avatar",avatar) },SQLiteDatabase.CONFLICT_IGNORE); if(avatar.isNotBlank()) writableDatabase.execSQL("UPDATE accounts SET avatar=? WHERE name=?",arrayOf(avatar,name.canonical())) }
    fun begin(name: String): Account {
        ensure(name)
        val account=account(name)!!
        if(account.pending) return account
        val start=readableDatabase.rawQuery("SELECT MAX(time) FROM plays WHERE account=?",arrayOf(name)).use { c -> c.moveToFirst(); c.getLong(0)/1000 }
        writableDatabase.execSQL("UPDATE accounts SET start=?,until=?,next_page=1,total_pages=0 WHERE name=?",arrayOf(start,System.currentTimeMillis()/1000,name))
        return account(name)!!
    }
    fun savePage(name: String,page: Int,records: List<Scrobble>,total: Int) = transaction { db ->
        db.delete("pages","account=? AND page=?",arrayOf(name,page.toString()))
        val insert=db.compileStatement("INSERT INTO pages(account,page,position,artist,album,track,time,image) VALUES(?,?,?,?,?,?,?,?)")
        insert.use { stmt -> records.forEachIndexed { i,s -> stmt.clearBindings(); stmt.bindString(1,name); stmt.bindLong(2,page.toLong()); stmt.bindLong(3,i.toLong()); stmt.bindString(4,s.artist); stmt.bindString(5,s.album); stmt.bindString(6,s.track); stmt.bindLong(7,s.timestamp); stmt.bindString(8,s.image); stmt.executeInsert() } }
        db.execSQL("UPDATE accounts SET next_page=?,total_pages=? WHERE name=?",arrayOf(page+1,total,name))
    }
    fun finish(name: String) = transaction { db ->
        val a=account(name) ?: return@transaction
        check(a.pending && a.nextPage>a.totalPages) { "History download is incomplete" }
        db.delete("plays","account=? AND time>=? AND time<=?",arrayOf(name,(a.from*1000).toString(),(a.until*1000).toString()))
        db.execSQL("INSERT INTO plays(account,artist,album,track,time,image) SELECT account,artist,album,track,time,image FROM pages WHERE account=? ORDER BY page DESC,position DESC",arrayOf(name))
        db.delete("pages","account=?",arrayOf(name))
        db.execSQL("UPDATE accounts SET last_sync=?,start=0,until=0,next_page=1,total_pages=0 WHERE name=?",arrayOf(System.currentTimeMillis(),name))
    }
    fun history(name: String): List<Scrobble> {
        val a=account(name) ?: return emptyList()
        val sql=if(a.pending) "SELECT artist,album,track,time,image FROM plays WHERE account=? AND (time<? OR time>?) UNION ALL SELECT artist,album,track,time,image FROM pages WHERE account=? ORDER BY time" else "SELECT artist,album,track,time,image FROM plays WHERE account=? ORDER BY time,id"
        val args=if(a.pending) arrayOf(name,(a.from*1000).toString(),(a.until*1000).toString(),name) else arrayOf(name)
        val strings=HashMap<String,String>()
        fun pooled(value: String)=strings.getOrPut(value) {value}
        return readableDatabase.rawQuery(sql,args).use { c -> buildList { while(c.moveToNext()) add(Scrobble(pooled(c.getString(0)),pooled(c.getString(1)),pooled(c.getString(2)),c.getLong(3),pooled(c.getString(4)))) } }
    }
    fun metadata(name: String): Map<Pair<EntityType,String>,Metadata> = readableDatabase.rawQuery("SELECT kind,entity_key,json FROM metadata WHERE account=?",arrayOf(name)).use { c -> buildMap { while(c.moveToNext()) {
        val j=JSONObject(c.getString(2)); val tags=j.optJSONArray("tags") ?: JSONArray()
        fun number(key: String)=if(j.isNull(key)) null else j.optLong(key)
        put(EntityType.valueOf(c.getString(0)) to c.getString(1), Metadata(number("listeners"),number("plays"),number("duration"),List(tags.length()) { tags.getString(it) },j.optString("image")))
    } } }
    fun saveMetadata(name: String,type: EntityType,key: String,m: Metadata) {
        val j=JSONObject().put("listeners",m.listeners ?: JSONObject.NULL).put("plays",m.globalPlays ?: JSONObject.NULL).put("duration",m.durationMs ?: JSONObject.NULL).put("tags",JSONArray(m.tags)).put("image",m.image)
        writableDatabase.insertWithOnConflict("metadata",null,ContentValues().apply { put("account",name); put("kind",type.name); put("entity_key",key); put("json",j.toString()) },SQLiteDatabase.CONFLICT_REPLACE)
    }
    fun importHistory(name: String,records: List<Scrobble>) = transaction { db ->
        ensure(name)
        listOf("plays","pages","metadata").forEach { db.delete(it,"account=?",arrayOf(name)) }
        db.execSQL("UPDATE accounts SET last_sync=0,start=0,until=0,next_page=1,total_pages=0 WHERE name=?",arrayOf(name))
        val insert=db.compileStatement("INSERT INTO plays(account,artist,album,track,time,image) VALUES(?,?,?,?,?,?)")
        insert.use { stmt -> records.forEach { s -> stmt.clearBindings(); stmt.bindString(1,name); stmt.bindString(2,s.artist); stmt.bindString(3,s.album); stmt.bindString(4,s.track); stmt.bindLong(5,s.timestamp); stmt.bindString(6,s.image); stmt.executeInsert() } }
    }
    fun deleteAccount(name: String) = transaction { db ->
        listOf("plays","pages","metadata").forEach { db.delete(it,"account=?",arrayOf(name)) }
        db.delete("accounts","name=?",arrayOf(name))
    }
}
