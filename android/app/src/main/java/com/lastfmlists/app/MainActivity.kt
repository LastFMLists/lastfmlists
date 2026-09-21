package com.lastfmlists.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels

class MainActivity: ComponentActivity() {
    private val model: MainViewModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) { super.onCreate(savedInstanceState); enableEdgeToEdge(); setContent { ListsTheme(model.theme) { ListsApp(model) } } }
    override fun onStop() { super.onStop(); if(!isChangingConfigurations) model.onBackground() }
}
