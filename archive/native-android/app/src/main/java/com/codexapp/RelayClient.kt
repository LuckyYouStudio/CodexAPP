package com.codexapp

import android.os.Handler
import android.os.Looper
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** OkHttp WebSocket link to the relay, with auto-reconnect. */
class RelayClient(
    private val onMessage: (JSONObject) -> Unit,
    private val onConn: (ConnState) -> Unit,
) {
    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // no read timeout for a long-lived socket
        .build()

    private val main = Handler(Looper.getMainLooper())
    private var ws: WebSocket? = null
    private var baseUrl = ""
    private var token = ""
    private var shouldRun = false
    private var backoffMs = 1000L

    fun connect(url: String, token: String) {
        this.baseUrl = url.trimEnd('/')
        this.token = token
        shouldRun = true
        backoffMs = 1000L
        open()
    }

    fun disconnect() {
        shouldRun = false
        ws?.close(1000, "bye")
        ws = null
    }

    fun send(obj: JSONObject) {
        ws?.send(obj.toString())
    }

    private fun wsUrl(): String {
        val b = if (baseUrl.startsWith("https"))
            baseUrl.replaceFirst("https", "wss")
        else
            baseUrl.replaceFirst("http", "ws")
        return "$b/ws?token=$token"
    }

    private fun open() {
        if (!shouldRun) return
        onConn(ConnState.CONNECTING)
        val req = Request.Builder().url(wsUrl()).build()
        ws = client.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                backoffMs = 1000L
                onConn(ConnState.CONNECTED)
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try { onMessage(JSONObject(text)) } catch (_: Exception) {}
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onConn(ConnState.DISCONNECTED)
                if (code == 4001) shouldRun = false else scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                onConn(ConnState.DISCONNECTED)
                scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (!shouldRun) return
        val delay = backoffMs
        backoffMs = (backoffMs * 1.6).toLong().coerceAtMost(15000L)
        main.postDelayed({ open() }, delay)
    }
}
