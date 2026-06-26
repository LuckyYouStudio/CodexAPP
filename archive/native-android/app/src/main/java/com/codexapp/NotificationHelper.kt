package com.codexapp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import android.Manifest

object NotificationHelper {
    private const val CHANNEL = "approvals"

    fun ensureChannel(ctx: Context) {
        val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (mgr.getNotificationChannel(CHANNEL) == null) {
            val ch = NotificationChannel(CHANNEL, "审批请求", NotificationManager.IMPORTANCE_HIGH)
            ch.description = "Codex 请求审批时通知"
            ch.enableVibration(true)
            mgr.createNotificationChannel(ch)
        }
    }

    fun notifyApproval(ctx: Context, a: Approval) {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) return
        ensureChannel(ctx)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Codex 需要审批：${a.title}")
            .setContentText(a.command)
            .setStyle(NotificationCompat.BigTextStyle().bigText(a.command))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        NotificationManagerCompat.from(ctx).notify(a.key.hashCode(), n)
    }
}
