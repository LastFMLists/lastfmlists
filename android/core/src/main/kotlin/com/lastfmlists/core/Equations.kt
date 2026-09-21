package com.lastfmlists.core

/** Small expression parser. User input never executes code. */
class Equations(private val analytics: Analytics, private val x: Int) {
    data class Pipeline(val tracks: List<Scrobble>,val ordered: Boolean,val shown: List<String>)
    private val fields = buildSet {
        for(kind in listOf("artist","album","track")) for(suffix in listOf("name","name-length","word-count","scrobble-count","rank","first-scrobble-year","days-since-last","listeners","global-scrobbles")) add("$kind-$suffix")
        addAll(listOf("artist-track-count","album-track-count","track-duration","scrobble-order","year","month","day-of-month","weekday","oldest-average-listening-time","newest-average-listening-time"))
    }
    private val fieldNames=fields.sortedByDescending { it.length }
    private fun value(s: Scrobble,f: String)=analytics.field(s,f,x)
    fun apply(input: List<Scrobble>,text: String): Pipeline {
        var tracks=input; var ordered=false; val shown=mutableListOf<String>()
        for(clause in clauses(text)) {
            val words=clause.split(Regex("\\s+"))
            when(words[0].canonical()) {
                "sort","unique","show" -> {
                    val field=words.getOrNull(1)?.canonical()
                    require(field in fields) { "Unknown equation field: $field" }
                    require(words.size in 2..3) { "Invalid command: $clause" }
                    when(words[0].canonical()) {
                        "sort" -> {
                            val direction=words.getOrNull(2)?.canonical() ?: "asc"
                            require(direction in listOf("asc","desc")) { "Sort direction must be asc or desc" }
                            ordered=true
                            val comparator=Comparator<Scrobble> { a,b -> compare(value(a,field!!),value(b,field)) }
                            tracks=tracks.filter { value(it,field!!) != null }.sortedWith(if(direction=="desc") comparator.reversed() else comparator)
                        }
                        "unique" -> {
                            ordered=true
                            val limit=words.getOrNull(2)?.toIntOrNull() ?: if(words.size==2) 1 else error("Unique limit must be a number")
                            require(limit>0) { "Unique limit must be positive" }
                            val counts=mutableMapOf<Any?,Int>()
                            tracks=tracks.filter { s -> val v=value(s,field!!); val key=if(v is String) v.trim().canonical() else v; val n=counts.getOrDefault(key,0); counts[key]=n+1; n<limit }
                        }
                        else -> { require(words.size==2) { "show takes one field" }; if(field !in shown) shown.add(field!!) }
                    }
                }
                else -> {
                    val expression=if(words[0].equals("filter",true)) clause.substringAfter(' ').trim() else clause
                    val tokens=tokenize(expression)
                    val parser=Parser(tokens)
                    val left=parser.expression()
                    val op=parser.take()
                    require(op in listOf("=","==","!=","<",">","<=",">=")) { "Expected a comparison in: $clause" }
                    val right=parser.expression(); require(parser.done()) { "Unexpected token in: $clause" }
                    tracks=tracks.filter { s ->
                        val a=left(s); val b=right(s)
                        if(a==null || b==null) false
                        else if(a is Number && b is Number) when(op) { "=","==" -> a.toDouble()==b.toDouble(); "!=" -> a.toDouble()!=b.toDouble(); "<" -> a.toDouble()<b.toDouble(); ">" -> a.toDouble()>b.toDouble(); "<=" -> a.toDouble()<=b.toDouble(); else -> a.toDouble()>=b.toDouble() }
                        else if(a is String && b is String && op in listOf("=","==","!=")) (a.trim().equals(b.trim(),true)) != (op=="!=") else false
                    }
                }
            }
        }
        return Pipeline(tracks,ordered,shown)
    }
    private fun clauses(text: String): List<String> {
        val parts=mutableListOf<String>(); val current=StringBuilder(); var quote: Char?=null
        text.forEach { c ->
            if(quote!=null) { current.append(c); if(c==quote) quote=null }
            else if(c=='\'' || c=='"') { quote=c; current.append(c) }
            else if(c==';' || c=='\n') { if(current.isNotBlank()) parts.add(current.toString().trim()); current.clear() }
            else current.append(c)
        }
        require(quote==null) { "Unclosed quote in equations" }
        if(current.isNotBlank()) parts.add(current.toString().trim())
        return parts
    }
    private fun tokenize(text: String): List<String> {
        val result=mutableListOf<String>(); var i=0
        while(i<text.length) {
            when {
                text[i].isWhitespace() -> i++
                text[i]=='\'' || text[i]=='"' -> { val end=text.indexOf(text[i],i+1); require(end>=0) { "Unclosed quote" }; result.add(text.substring(i,end+1)); i=end+1 }
                text[i].isDigit() -> { var end=i+1; while(end<text.length && (text[end].isDigit() || text[end]=='.')) end++; val token=text.substring(i,end); require(token.toDoubleOrNull()!=null) { "Invalid number" }; result.add(token); i=end }
                text[i] in "+-*/%()=<>!" -> { val pair=text.substring(i,minOf(i+2,text.length)); if(pair in listOf("<=",">=","!=","==")) { result.add(pair); i+=2 } else { result.add(text[i].toString()); i++ } }
                else -> { val field=fieldNames.firstOrNull { text.regionMatches(i,it,0,it.length,true) } ?: error("Unknown field near '${text.substring(i).take(30)}'"); result.add(field); i+=field.length }
            }
        }
        return result
    }
    private inner class Parser(private val tokens: List<String>) {
        var i=0
        fun take(): String = tokens.getOrNull(i++) ?: error("Incomplete equation")
        fun done()=i==tokens.size
        fun expression(): (Scrobble)->Any? {
            var left=term()
            while(tokens.getOrNull(i) in listOf("+","-")) { val op=take(); val a=left; val b=term(); left={ s -> arithmetic(a(s),b(s),op) } }
            return left
        }
        fun term(): (Scrobble)->Any? {
            var left=factor()
            while(tokens.getOrNull(i) in listOf("*","/","%")) { val op=take(); val a=left; val b=factor(); left={ s -> arithmetic(a(s),b(s),op) } }
            return left
        }
        fun factor(): (Scrobble)->Any? {
            val token=take()
            return when {
                token=="-" -> { val f=factor(); { s -> (f(s) as? Number)?.toDouble()?.unaryMinus() } }
                token=="(" -> { val f=expression(); require(take()==")") { "Missing closing parenthesis" }; f }
                token.startsWith("\"") || token.startsWith("'") -> { _ -> token.substring(1,token.length-1) }
                token.toDoubleOrNull()!=null -> { _ -> token.toDouble() }
                token in fields -> { s -> value(s,token) }
                else -> error("Unexpected token: $token")
            }
        }
    }
    private fun arithmetic(a: Any?,b: Any?,op: String): Double? {
        if(a !is Number || b !is Number) return null
        val l=a.toDouble(); val r=b.toDouble()
        val result=when(op) { "+" -> l+r; "-" -> l-r; "*" -> l*r; "/" -> if(r==0.0) return null else l/r; else -> if(r==0.0) return null else l%r }
        return result.takeIf { it.isFinite() }
    }
    private fun compare(a: Any?,b: Any?): Int = if(a is Number && b is Number) a.toDouble().compareTo(b.toDouble()) else naturalCompare(a.toString(),b.toString())
    private fun naturalCompare(a: String,b: String): Int {
        val chunks=Regex("\\d+|\\D+")
        val left=chunks.findAll(a.canonical()).map { it.value }.toList(); val right=chunks.findAll(b.canonical()).map { it.value }.toList()
        for(i in 0 until minOf(left.size,right.size)) { val l=left[i]; val r=right[i]; val cmp=if(l.all(Char::isDigit) && r.all(Char::isDigit)) l.toBigInteger().compareTo(r.toBigInteger()) else l.compareTo(r); if(cmp!=0) return cmp }
        return left.size.compareTo(right.size)
    }
}
