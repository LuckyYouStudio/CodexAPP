package com.codexapp.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Accent = Color(0xFF35D07F)
val Danger = Color(0xFFFF5C6C)
val Warn = Color(0xFFFFB454)
val Bg = Color(0xFF0B1220)
val Surface1 = Color(0xFF15203A)
val Surface2 = Color(0xFF1B2950)
val Line = Color(0xFF243154)
val TextMain = Color(0xFFE6ECF7)
val Muted = Color(0xFF8A98B8)

private val scheme = darkColorScheme(
    primary = Accent,
    onPrimary = Color(0xFF04331E),
    secondary = Surface2,
    onSecondary = TextMain,
    background = Bg,
    onBackground = TextMain,
    surface = Surface1,
    onSurface = TextMain,
    surfaceVariant = Surface2,
    onSurfaceVariant = Muted,
    error = Danger,
    outline = Line,
)

@Composable
fun CodexAppTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, content = content)
}
