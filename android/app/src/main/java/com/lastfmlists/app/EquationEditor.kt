package com.lastfmlists.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.lastfmlists.core.*

@Composable fun EquationEditor(text: String,onValidity: (Boolean)->Unit={},onChange: (String)->Unit) {
    val initial=remember {runCatching {EquationPlan.decode(text)}}
    var steps by remember {mutableStateOf(initial.getOrDefault(emptyList()))}
    var advanced by remember {mutableStateOf(initial.isFailure)}
    var help by remember {mutableStateOf(false)}
    var problem by remember {mutableStateOf(initial.exceptionOrNull()?.message)}
    var raw by remember {mutableStateOf(text)}
    fun update(next: List<EquationStep>) {
        steps=next
        runCatching {EquationPlan.encode(next)}.onSuccess {raw=it;onChange(it);problem=null;onValidity(true)}.onFailure {problem=it.message;onValidity(false)}
    }
    LaunchedEffect(Unit) {onValidity(initial.isSuccess)}
    Text("Rules and transformations",style=MaterialTheme.typography.titleLarge)
    Text("Steps run from top to bottom on plays that pass your filters, before the list is grouped and ranked. Counts and ranks refer to the full library.",style=MaterialTheme.typography.bodySmall)
    TextButton(onClick={help=!help}) {Text(if(help) "Hide guide" else "How to use rules")}
    if(help) {
        Text("1. Add Keep matching plays to compare a field with a number, text or another field. Multiple conditions must all match.\n2. Add Order plays to change the order used by later steps.\n3. Add Keep first per value to keep a limited number of plays for each artist, album or other value. This changes counts.\n4. Add Show value to include extra information in result rows.\n\nFor a calculation, choose Calculation on either side. Each group has two values and an operation; groups can contain other calculations. Missing metadata and division by zero do not match.",style=MaterialTheme.typography.bodyMedium)
        Text("Examples (replace current rules)",style=MaterialTheme.typography.titleSmall)
        TextButton(onClick={advanced=false;update(listOf(EquationStep()))}) {Text("Tracks with at least 10 plays")}
        TextButton(onClick={advanced=false;update(listOf(EquationStep(left=Operand.Calculation(Operand.Field("track-scrobble-count"),"/",Operand.Field("artist-scrobble-count")),comparison=">=",right=Operand.Number("0.1"))))}) {Text("Tracks with at least 10% of their artist’s plays")}
        TextButton(onClick={advanced=false;update(listOf(EquationStep(action="sort",field="scrobble-order",direction="desc"),EquationStep(action="unique",field="artist-name",limit="3"),EquationStep(action="show",field="artist-rank")))}) {Text("Last 3 plays per artist, with library rank")}
    }
    if(advanced) {
        OutlinedTextField(raw,{raw=it;onChange(it);runCatching {EquationPlan.decode(it)}.onSuccess {plan ->steps=plan;problem=null;onValidity(true)}.onFailure {e ->problem=e.message;onValidity(false)}},label={Text("Advanced syntax")},modifier=Modifier.fillMaxWidth(),minLines=5)
        TextButton(onClick={advanced=false},enabled=problem==null) {Text("Use visual editor")}
    } else {
        steps.forEachIndexed {index,step ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                    Text("Step ${index+1}",style=MaterialTheme.typography.titleMedium)
                    fun change(value: EquationStep) {update(steps.toMutableList().also {it[index]=value})}
                    Choice("Operation",step.action,listOf("filter" to "Keep matching plays","sort" to "Order plays","unique" to "Keep first per value","show" to "Show value"),{change(step.copy(action=it))})
                    if(step.action=="filter") {
                        OperandEditor("Compare",step.left,{change(step.copy(left=it))})
                        Choice("Condition",step.comparison,listOf("=" to "equals","!=" to "does not equal",">" to "is greater than",">=" to "is at least","<" to "is less than","<=" to "is at most"),{change(step.copy(comparison=it))})
                        OperandEditor("With",step.right,{change(step.copy(right=it))})
                    } else {
                        Choice("Field",step.field,EquationFields.options,{change(step.copy(field=it))})
                        if(step.action=="sort") Choice("Order",step.direction,listOf("asc" to "Ascending · A–Z / smallest first","desc" to "Descending · Z–A / largest first"),{change(step.copy(direction=it))})
                        if(step.action=="unique") OutlinedTextField(step.limit,{change(step.copy(limit=it))},label={Text("Plays per value")},keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number),singleLine=true,modifier=Modifier.fillMaxWidth())
                    }
                    Row {
                        TextButton(onClick={val n=steps.toMutableList();n.add(index-1,n.removeAt(index));update(n)},enabled=index>0) {Text("Up")}
                        TextButton(onClick={val n=steps.toMutableList();n.add(index+1,n.removeAt(index));update(n)},enabled=index<steps.lastIndex) {Text("Down")}
                        TextButton(onClick={update(steps.filterIndexed {i,_->i!=index})}) {Text("Remove")}
                    }
                }
            }
        }
        OutlinedButton(onClick={update(steps+EquationStep())},modifier=Modifier.fillMaxWidth()) {Text("Add step")}
        TextButton(onClick={advanced=true}) {Text("Advanced text editor")}
    }
    problem?.let {Text(it,color=MaterialTheme.colorScheme.error)}
}

@Composable private fun OperandEditor(label: String,value: Operand,onChange: (Operand)->Unit,depth: Int=0) {
    val kind=when(value) {is Operand.Field->"field";is Operand.Number->"number";is Operand.Text->"text";is Operand.Calculation->"calculation"}
    Column(Modifier.padding(start=if(depth>0) 8.dp else 0.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Choice(label,kind,listOf("field" to "Library field","number" to "Number","text" to "Text","calculation" to "Calculation"),{onChange(when(it) {"field"->Operand.Field();"number"->Operand.Number();"text"->Operand.Text();else->Operand.Calculation()})})
        when(value) {
            is Operand.Field -> Choice("Value",value.id,EquationFields.options,{onChange(Operand.Field(it))})
            is Operand.Number -> OutlinedTextField(value.text,{onChange(Operand.Number(it))},label={Text("Number")},modifier=Modifier.fillMaxWidth(),singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
            is Operand.Text -> OutlinedTextField(value.text,{onChange(Operand.Text(it))},label={Text("Text to match")},modifier=Modifier.fillMaxWidth(),singleLine=true)
            is Operand.Calculation -> {
                Text("Calculation group",style=MaterialTheme.typography.labelMedium)
                OperandEditor("First value",value.left,{onChange(value.copy(left=it))},depth+1)
                Choice("Calculate",value.operator,listOf("+" to "Add","-" to "Subtract","*" to "Multiply","/" to "Divide","%" to "Remainder"),{onChange(value.copy(operator=it))})
                OperandEditor("Second value",value.right,{onChange(value.copy(right=it))},depth+1)
            }
        }
    }
}
