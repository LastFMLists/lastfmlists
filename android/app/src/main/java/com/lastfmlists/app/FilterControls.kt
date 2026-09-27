@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package com.lastfmlists.app

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.text.format.DateFormat
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.lastfmlists.core.FilterField
import java.time.LocalDate
import java.time.LocalTime
import java.time.Month
import java.time.format.TextStyle
import java.util.Locale

internal fun toggleNumber(value: String, number: Int): String {
    val selected=value.split(',').mapNotNull {it.trim().toIntOrNull()}.toMutableSet()
    if(!selected.add(number)) selected.remove(number)
    return selected.sorted().joinToString(",")
}

private fun terms(value: String)=value.split(';').map {group ->group.split(',').map {it.trim()}.filter {it.isNotEmpty()}}.filter {it.isNotEmpty()}
private fun encodeTerms(groups: List<List<String>>)=groups.joinToString(";") {it.joinToString(",")}
internal fun appendTerm(value: String,term: String,required: Boolean): String {
    val clean=term.trim().replace(Regex("[,;]")," ")
    if(clean.isEmpty()) return value
    val groups=terms(value).toMutableList()
    if(groups.isEmpty() || required) groups.add(listOf(clean)) else groups[groups.lastIndex]=groups.last()+clean
    return encodeTerms(groups)
}
internal fun removeTerm(value: String,group: Int,index: Int): String = encodeTerms(terms(value).mapIndexedNotNull {g,words ->
    val remaining=if(g==group) words.filterIndexed {i,_->i!=index} else words
    remaining.takeIf {it.isNotEmpty()}
})

internal fun filterValueLabel(id: String,value: String): String = when(id) {
    "weekday" -> value.split(',').mapNotNull {it.trim().toIntOrNull()?.takeIf {n->n in 0..6}?.let {n->listOf("Sun","Mon","Tue","Wed","Thu","Fri","Sat")[n]}}.joinToString(", ").ifBlank {value}
    "month" -> value.split(',').mapNotNull {it.trim().toIntOrNull()?.takeIf {n->n in 1..12}?.let {n->Month.of(n).getDisplayName(TextStyle.SHORT,Locale.getDefault())}}.joinToString(", ").ifBlank {value}
    "last-n-days" -> "$value days"
    "session-starter-only","day-starter-only" -> com.lastfmlists.core.Catalog.fields.firstOrNull {it.id==id}?.options?.firstOrNull {it.first==value}?.second ?: value
    else -> value.replace(",",", ")
}

@Composable fun PresetNumberControl(label: String,value: String,options: List<Pair<String,String>>,onChange: (String)->Unit,modifier: Modifier=Modifier,description: String?=null) {
    var custom by rememberSaveable(label) {mutableStateOf(value.isNotBlank() && options.none {it.first==value})}
    OutlinedCard(modifier.fillMaxWidth()) {Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text(label,style=MaterialTheme.typography.titleSmall)
        description?.let {Text(it,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        FlowRow(horizontalArrangement=Arrangement.spacedBy(7.dp),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            options.forEach {(key,title)->FilterChip(selected=!custom && value==key,onClick={custom=false;onChange(key)},label={Text(title)})}
            FilterChip(selected=custom,onClick={custom=true},label={Text("Custom")})
        }
        if(custom) OutlinedTextField(value=value,onValueChange={input->onChange(input)},label={Text(label)},singleLine=true,modifier=Modifier.fillMaxWidth(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal),shape=RoundedCornerShape(12.dp))
    }}
}

@Composable fun PresetIntControl(label: String,value: Int,options: List<Pair<Int,String>>,onChange: (Int)->Unit,modifier: Modifier=Modifier,minimum: Int=0,description: String?=null) {
    var custom by rememberSaveable(label) {mutableStateOf(options.none {it.first==value})}
    var typed by rememberSaveable(label) {mutableStateOf(value.toString())}
    LaunchedEffect(value) {if(typed.toIntOrNull()!=value) typed=value.toString()}
    OutlinedCard(modifier.fillMaxWidth()) {Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text(label,style=MaterialTheme.typography.titleSmall)
        description?.let {Text(it,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        FlowRow(horizontalArrangement=Arrangement.spacedBy(7.dp),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            options.forEach {(number,title)->FilterChip(selected=!custom && value==number,onClick={custom=false;typed=number.toString();onChange(number)},label={Text(title)})}
            FilterChip(selected=custom,onClick={custom=true;typed=value.toString()},label={Text("Custom")})
        }
        if(custom) OutlinedTextField(typed,{input->typed=input.filter(Char::isDigit);typed.toIntOrNull()?.takeIf {it>=minimum}?.let(onChange)},label={Text(label)},singleLine=true,modifier=Modifier.fillMaxWidth(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number))
    }}
}

@Composable fun RangeFilterControl(label: String,minimum: String,maximum: String,onMinimum: (String)->Unit,onMaximum: (String)->Unit,enabled: Boolean,modifier: Modifier=Modifier) {
    OutlinedCard(modifier.fillMaxWidth().focusable()) {Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment=Alignment.CenterVertically) {
            Text(label,Modifier.weight(1f),style=MaterialTheme.typography.titleSmall)
            if(minimum.isNotBlank() || maximum.isNotBlank()) TextButton(onClick={onMinimum("");onMaximum("")},enabled=enabled) {Text("Clear")}
        }
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(minimum,onMinimum,label={Text("At least")},placeholder={Text("Any")},enabled=enabled,singleLine=true,modifier=Modifier.weight(1f),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
            OutlinedTextField(maximum,onMaximum,label={Text("At most")},placeholder={Text("Any")},enabled=enabled,singleLine=true,modifier=Modifier.weight(1f),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
        }
    }}
}

@Composable private fun MultiSelectFilter(label: String,value: String,options: List<Pair<Int,String>>,onChange: (String)->Unit,modifier: Modifier=Modifier,collapsed: Boolean=false) {
    var expanded by rememberSaveable(label) {mutableStateOf(!collapsed)}
    val selected=value.split(',').mapNotNull {it.trim().toIntOrNull()}.toSet()
    OutlinedCard(modifier.fillMaxWidth().focusable()) {Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment=Alignment.CenterVertically) {
            Text(label,Modifier.weight(1f),style=MaterialTheme.typography.titleSmall)
            if(value.isNotBlank()) TextButton(onClick={onChange("")}) {Text("Clear")}
            if(collapsed) IconButton(onClick={expanded=!expanded}) {Icon(if(expanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,if(expanded) "Hide choices" else "Show choices")}
        }
        if(!expanded) Text(if(selected.isEmpty()) "Any" else "${selected.size} selected",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        else FlowRow(horizontalArrangement=Arrangement.spacedBy(7.dp),verticalArrangement=Arrangement.spacedBy(2.dp)) {
            options.forEach {(number,title)->FilterChip(selected=number in selected,onClick={onChange(toggleNumber(value,number))},label={Text(title)})}
        }
    }}
}

@Composable private fun DateFilter(label: String,value: String,onChange: (String)->Unit,modifier: Modifier=Modifier) {
    val context=LocalContext.current
    OutlinedCard(onClick={
        val initial=runCatching {LocalDate.parse(value)}.getOrDefault(LocalDate.now())
        DatePickerDialog(context,{_,year,month,day->onChange(LocalDate.of(year,month+1,day).toString())},initial.year,initial.monthValue-1,initial.dayOfMonth).show()
    },modifier=modifier.fillMaxWidth()) {Row(Modifier.fillMaxWidth().padding(horizontal=14.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically) {
        Icon(Icons.Rounded.CalendarMonth,null,tint=MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {Text(label,style=MaterialTheme.typography.labelSmall);Text(value.ifBlank {"Any date"},style=MaterialTheme.typography.bodyLarge)}
        if(value.isNotBlank()) IconButton(onClick={onChange("")}) {Icon(Icons.Rounded.Close,"Clear $label")}
    }}
}

@Composable private fun TimeFilter(label: String,value: String,onChange: (String)->Unit,modifier: Modifier=Modifier) {
    val context=LocalContext.current
    OutlinedCard(onClick={
        val initial=runCatching {LocalTime.parse(value)}.getOrDefault(LocalTime.of(12,0))
        TimePickerDialog(context,{_,hour,minute->onChange(LocalTime.of(hour,minute).toString())},initial.hour,initial.minute,DateFormat.is24HourFormat(context)).show()
    },modifier=modifier.fillMaxWidth()) {Row(Modifier.fillMaxWidth().padding(horizontal=14.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically) {
        Icon(Icons.Rounded.Schedule,null,tint=MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {Text(label,style=MaterialTheme.typography.labelSmall);Text(value.ifBlank {"Any time"},style=MaterialTheme.typography.bodyLarge)}
        if(value.isNotBlank()) IconButton(onClick={onChange("")}) {Icon(Icons.Rounded.Close,"Clear $label")}
    }}
}

@Composable private fun YearFilter(label: String,value: String,onChange: (String)->Unit,modifier: Modifier=Modifier) {
    var entry by rememberSaveable(label) {mutableStateOf("")}
    val years=value.split(',').mapNotNull {it.trim().toIntOrNull()?.takeIf {year->year in 1..9999}}.distinct()
    fun add() {val year=entry.toIntOrNull()?.takeIf {it in 1..9999} ?: return;onChange((years+year).distinct().sorted().joinToString(","));entry=""}
    OutlinedCard(modifier.fillMaxWidth().focusable()) {Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text(label,style=MaterialTheme.typography.titleSmall)
        if(years.isEmpty()) Text("Any year",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        else FlowRow(horizontalArrangement=Arrangement.spacedBy(7.dp)) {years.forEach {year->InputChip(selected=true,onClick={onChange(years.filterNot {it==year}.joinToString(","))},label={Text("$year")},trailingIcon={Icon(Icons.Rounded.Close,"Remove $year")})}}
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=Alignment.CenterVertically) {
            OutlinedTextField(entry,{entry=it.filter(Char::isDigit).take(4)},label={Text("Add year")},singleLine=true,modifier=Modifier.weight(1f),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number,imeAction=ImeAction.Done),keyboardActions=KeyboardActions(onDone={add()}))
            FilledTonalButton(onClick={add()},enabled=entry.toIntOrNull()?.let {it in 1..9999 && it !in years}==true) {Text("Add")}
        }
    }}
}

@Composable private fun TermsFilter(label: String,value: String,onChange: (String)->Unit,modifier: Modifier=Modifier,exclude: Boolean=false,enabled: Boolean=true) {
    var entry by rememberSaveable(label) {mutableStateOf("")}
    val groups=terms(value)
    fun add(required: Boolean) {if(entry.isNotBlank()) {onChange(appendTerm(value,entry,required));entry=""}}
    OutlinedCard(modifier.fillMaxWidth().focusable()) {Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text(label,style=MaterialTheme.typography.titleSmall)
        Text(if(exclude) "Exclude when every group matches. Words in the same group are alternatives." else "Every group must match. Words in the same group are alternatives.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        groups.forEachIndexed {groupIndex,words ->
            Text(if(groupIndex==0) "Match any of" else "And match any of",style=MaterialTheme.typography.labelMedium)
            FlowRow(horizontalArrangement=Arrangement.spacedBy(7.dp)) {words.forEachIndexed {index,word->InputChip(selected=true,onClick={onChange(removeTerm(value,groupIndex,index))},enabled=enabled,label={Text(word)},trailingIcon={Icon(Icons.Rounded.Close,"Remove $word")})}}
        }
        OutlinedTextField(entry,{entry=it},label={Text("Word or phrase")},enabled=enabled,singleLine=true,modifier=Modifier.fillMaxWidth(),keyboardOptions=KeyboardOptions(imeAction=ImeAction.Done),keyboardActions=KeyboardActions(onDone={add(false)}))
        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            FilledTonalButton(onClick={add(false)},enabled=enabled && entry.isNotBlank()) {Text("Add alternative")}
            OutlinedButton(onClick={add(true)},enabled=enabled && entry.isNotBlank()) {Text("Add required")}
        }
    }}
}

@Composable fun FilterFieldControl(field: FilterField,value: String,enabled: Boolean,onChange: (String)->Unit,modifier: Modifier=Modifier) {
    when(field.id) {
        "weekday" -> MultiSelectFilter("Weekdays",value,listOf("Sun","Mon","Tue","Wed","Thu","Fri","Sat").mapIndexed {i,name->i to name},onChange,modifier)
        "month" -> MultiSelectFilter("Months",value,(1..12).map {it to Month.of(it).getDisplayName(TextStyle.SHORT,Locale.getDefault())},onChange,modifier)
        "day-of-month" -> MultiSelectFilter("Days of the month",value,(1..31).map {it to it.toString()},onChange,modifier,collapsed=true)
        "date-range-start","date-range-end" -> DateFilter(field.label,value,onChange,modifier)
        "time-of-day-start","time-of-day-end" -> TimeFilter(field.label,value,onChange,modifier)
        "last-n-days" -> PresetNumberControl("Played within the last",value,listOf("" to "Any time","7" to "7 days","30" to "30 days","90" to "90 days","365" to "365 days"),onChange,modifier)
        "day-starter-gap-hours" -> PresetNumberControl("Long gap",value,listOf("" to "Default · 6h","4" to "4h","6" to "6h","12" to "12h","24" to "24h"),onChange,modifier,"Used for session and smart day starters.")
        "year" -> YearFilter("Years",value,onChange,modifier)
        else -> when {
            field.id.endsWith("-years") -> YearFilter(field.label,value,onChange,modifier)
            field.id.endsWith("-includes") || field.id.endsWith("-excludes") || field.id=="artist-tags" -> TermsFilter(field.label,value,onChange,modifier,field.id.endsWith("-excludes"),enabled)
            field.options.isNotEmpty() -> Choice(field.label,value,field.options,onChange,modifier)
            else -> OutlinedTextField(value,onChange,label={Text(field.label)},placeholder={if(field.hint.isNotBlank()) Text(field.hint)},enabled=enabled,singleLine=true,modifier=modifier.fillMaxWidth(),shape=RoundedCornerShape(12.dp),keyboardOptions=KeyboardOptions(keyboardType=if(field.id.endsWith("-min") || field.id.endsWith("-max") || field.id.startsWith("scrobble-order-")) KeyboardType.Decimal else KeyboardType.Text))
        }
    }
}
