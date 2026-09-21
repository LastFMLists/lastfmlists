package com.lastfmlists.app

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val Light=lightColorScheme(primary=Color(0xFF9E4A26),onPrimary=Color.White,primaryContainer=Color(0xFFF4D8C7),onPrimaryContainer=Color(0xFF502812),secondary=Color(0xFF76624C),background=Color(0xFFFFFCF8),onBackground=Color(0xFF3B2F24),surface=Color(0xFFFFFCF8),onSurface=Color(0xFF3B2F24),surfaceVariant=Color(0xFFF1E1CC),onSurfaceVariant=Color(0xFF6C5A4B),outline=Color(0xFF8C7964),surfaceContainer=Color(0xFFF8F1E6),surfaceContainerLow=Color(0xFFFCF6EF))
private val Dark=darkColorScheme(primary=Color(0xFF85BBFB),onPrimary=Color(0xFF0B1424),primaryContainer=Color(0xFF293F5B),onPrimaryContainer=Color(0xFFDBEAFF),secondary=Color(0xFFB0BDCD),background=Color(0xFF111827),onBackground=Color(0xFFDCE9F7),surface=Color(0xFF111827),onSurface=Color(0xFFDCE9F7),surfaceVariant=Color(0xFF26354A),onSurfaceVariant=Color(0xFFAFBDCF),outline=Color(0xFF8C9DB2),surfaceContainer=Color(0xFF1E293B),surfaceContainerLow=Color(0xFF182233))
@Composable fun ListsTheme(choice: String,content: @Composable ()->Unit) {
    val dark=choice=="Dark" || (choice=="System" && isSystemInDarkTheme())
    MaterialTheme(colorScheme=if(dark) Dark else Light,typography=Typography(
        displaySmall=TextStyle(fontSize=36.sp,lineHeight=41.sp,fontWeight=FontWeight.Bold,letterSpacing=(-1).sp),
        headlineMedium=TextStyle(fontSize=28.sp,lineHeight=34.sp,fontWeight=FontWeight.Bold,letterSpacing=(-0.5).sp),
        titleLarge=TextStyle(fontSize=22.sp,lineHeight=28.sp,fontWeight=FontWeight.SemiBold),
        titleMedium=TextStyle(fontSize=16.sp,lineHeight=23.sp,fontWeight=FontWeight.SemiBold),
        labelLarge=TextStyle(fontSize=14.sp,lineHeight=20.sp,fontWeight=FontWeight.SemiBold),
        bodyLarge=TextStyle(fontFamily=FontFamily.SansSerif,fontSize=16.sp,lineHeight=24.sp)
    ),content=content)
}
