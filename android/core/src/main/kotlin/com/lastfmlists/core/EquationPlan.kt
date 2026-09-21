package com.lastfmlists.core

object EquationFields {
    val options=buildList {
        for(kind in listOf("artist","album","track")) {
            val label=kind.replaceFirstChar {it.uppercase()}
            for((id,title) in listOf("name" to "name","name-length" to "name length","word-count" to "name word count","scrobble-count" to "play count","rank" to "library rank","first-scrobble-year" to "first listen year","days-since-last" to "days since last listen","listeners" to "global listeners","global-scrobbles" to "global plays")) add("$kind-$id" to "$label $title")
        }
        addAll(listOf("artist-track-count" to "Artist distinct tracks","album-track-count" to "Album distinct tracks","track-duration" to "Track duration (seconds)","scrobble-order" to "Play position in history","year" to "Play year","month" to "Play month (1–12)","day-of-month" to "Day of month","weekday" to "Weekday (0 = Sunday)","oldest-average-listening-time" to "Average listen date (earliest)","newest-average-listening-time" to "Average listen date (latest, negative timestamp)"))
    }
    fun label(id: String)=options.firstOrNull {it.first==id}?.second ?: id
    fun isText(id: String)=id.endsWith("-name")
}

sealed interface Operand {
    data class Field(val id: String="track-scrobble-count"): Operand
    data class Number(val text: String="10"): Operand
    data class Text(val text: String=""): Operand
    data class Calculation(val left: Operand=Field(),val operator: String="/",val right: Operand=Number("2")): Operand
    fun isText(): Boolean=when(this) {is Text -> true;is Field -> EquationFields.isText(id);else -> false}
    fun code(): String = when(this) {
        is Field -> {require(EquationFields.options.any {it.first==id}) {"Choose a field"};id}
        is Number -> {require(text.toDoubleOrNull()?.isFinite()==true) {"Enter a valid number"};java.math.BigDecimal(text).toPlainString()}
        is Text -> {require(!text.contains('\n')) {"Text cannot contain line breaks"};when { !text.contains('"') -> "\"$text\"";!text.contains('\'') -> "'$text'";else -> error("Text cannot contain both quote styles")}}
        is Calculation -> {require(!left.isText() && !right.isText()) {"Calculations need numeric values"};require(operator in listOf("+","-","*","/","%"));"(${left.code()} $operator ${right.code()})"}
    }
}
data class EquationStep(val action: String="filter",val left: Operand=Operand.Field(),val comparison: String=">=",val right: Operand=Operand.Number(),val field: String="artist-name",val direction: String="asc",val limit: String="1") {
    fun code(): String=when(action) {
        "filter" -> {require(comparison in listOf("=","!=","<",">","<=",">="));require(left.isText()==right.isText()) {"Compare text with text, or numbers with numbers"};require(!left.isText() || comparison in listOf("=","!=")) {"Text supports equals and does not equal"};"filter ${left.code()} $comparison ${right.code()}"}
        "sort" -> {require(direction in listOf("asc","desc"));"sort ${Operand.Field(field).code()} $direction"}
        "unique" -> {require(limit.toIntOrNull()?.let {it>0}==true) {"Keep at least one play per value"};"unique ${Operand.Field(field).code()} $limit"}
        "show" -> "show ${Operand.Field(field).code()}"
        else -> error("Unknown operation")
    }
}

object EquationPlan {
    fun encode(steps: List<EquationStep>)=steps.joinToString(";\n") {it.code()}
    fun decode(text: String): List<EquationStep> {
        val clauses=mutableListOf<String>();var quote: Char?=null;val part=StringBuilder()
        text.forEach {c -> if(quote!=null) {part.append(c);if(c==quote) quote=null} else if(c=='\'' || c=='"') {quote=c;part.append(c)} else if(c==';' || c=='\n') {if(part.isNotBlank()) clauses.add(part.toString().trim());part.clear()} else part.append(c)}
        require(quote==null) {"Close the quoted text"};if(part.isNotBlank()) clauses.add(part.toString().trim())
        return clauses.map {clause ->
            val words=clause.split(Regex("\\s+"));val action=words.first().canonical()
            if(action in listOf("sort","unique","show")) {
                require(words.size in 2..3)
                EquationStep(action=action,field=words[1].canonical(),direction=if(action=="sort") words.getOrElse(2) {"asc"}.canonical() else "asc",limit=if(action=="unique") words.getOrElse(2) {"1"} else "1").also {it.code();require(action!="show" || words.size==2)}
            } else {
                val parser=ExpressionReader(if(action=="filter") clause.substringAfter(' ') else clause)
                val left=parser.expression();val comparison=parser.take().let {if(it=="==") "=" else it};val right=parser.expression()
                require(parser.done()) {"Unexpected text after the condition"}
                EquationStep(left=left,comparison=comparison,right=right).also {it.code()}
            }
        }
    }
    private class ExpressionReader(text: String) {
        private val tokens=mutableListOf<String>();private var i=0
        init {
            var p=0;val names=EquationFields.options.map {it.first}.sortedByDescending {it.length}
            while(p<text.length) {
                val c=text[p]
                when {
                    c.isWhitespace() -> p++
                    c=='\'' || c=='"' -> {val end=text.indexOf(c,p+1);require(end>=0);tokens.add(text.substring(p,end+1));p=end+1}
                    c.isDigit() || c=='.' -> {var end=p+1;while(end<text.length && (text[end].isDigit() || text[end]=='.')) end++;tokens.add(text.substring(p,end));p=end}
                    c in "+-*/%()=<>!" -> {val pair=text.substring(p,minOf(p+2,text.length));val t=if(pair in listOf("<=",">=","!=","==")) pair else "$c";tokens.add(t);p+=t.length}
                    else -> {val f=names.firstOrNull {text.regionMatches(p,it,0,it.length,true)} ?: error("Unknown field near ${text.substring(p).take(20)}");tokens.add(f);p+=f.length}
                }
            }
        }
        fun take()=tokens.getOrNull(i++) ?: error("Complete both sides of the condition")
        fun done()=i==tokens.size
        fun expression(): Operand {var a=term();while(tokens.getOrNull(i) in listOf("+","-")) {val op=take();a=Operand.Calculation(a,op,term())};return a}
        private fun term(): Operand {var a=factor();while(tokens.getOrNull(i) in listOf("*","/","%")) {val op=take();a=Operand.Calculation(a,op,factor())};return a}
        private fun factor(): Operand {
            val token=take()
            return when {
                token=="(" -> expression().also {require(take()==")") {"Close the calculation group"}}
                token=="-" -> Operand.Calculation(Operand.Number("0"),"-",factor())
                token.startsWith('"') || token.startsWith('\'') -> Operand.Text(token.substring(1,token.length-1))
                token.toDoubleOrNull()!=null -> Operand.Number(token)
                EquationFields.options.any {it.first==token} -> Operand.Field(token)
                else -> error("Choose a field, number or text")
            }
        }
    }
}
