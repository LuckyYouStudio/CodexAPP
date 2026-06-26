package com.codexapp

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import com.codexapp.ui.AppScreen
import com.codexapp.ui.CodexAppTheme

class MainActivity : ComponentActivity() {
    private val vm: RelayViewModel by viewModels()
    private val notifPerm =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        NotificationHelper.ensureChannel(this)
        if (Build.VERSION.SDK_INT >= 33) {
            notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        vm.autoConnect()
        setContent {
            CodexAppTheme { AppScreen(vm) }
        }
    }
}
