package com.codexapp

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class RelayViewModel(app: Application) : AndroidViewModel(app) {

    private val prefs = app.getSharedPreferences("codexapp", Context.MODE_PRIVATE)

    private val _conn = MutableStateFlow(ConnState.DISCONNECTED)
    val conn: StateFlow<ConnState> = _conn.asStateFlow()

    private val _state = MutableStateFlow(AppState())
    val state: StateFlow<AppState> = _state.asStateFlow()

    private val _feed = MutableStateFlow<List<FeedEvent>>(emptyList())
    val feed: StateFlow<List<FeedEvent>> = _feed.asStateFlow()

    private val _approvals = MutableStateFlow<List<Approval>>(emptyList())
    val approvals: StateFlow<List<Approval>> = _approvals.asStateFlow()

    private val _hasCreds = MutableStateFlow(prefs.getString("token", null) != null)
    val hasCreds: StateFlow<Boolean> = _hasCreds.asStateFlow()

    private var liveAssistantId: String? = null
    private val client = RelayClient(::handle) { _conn.value = it }

    val savedUrl: String get() = prefs.getString("url", "") ?: ""

    fun autoConnect() {
        val url = prefs.getString("url", null)
        val token = prefs.getString("token", null)
        if (url != null && token != null) client.connect(url, token)
    }

    fun saveAndConnect(url: String, token: String) {
        val u = url.trim().trimEnd('/')
        prefs.edit().putString("url", u).putString("token", token.trim()).apply()
        _hasCreds.value = true
        client.connect(u, token.trim())
    }

    fun forget() {
        client.disconnect()
        prefs.edit().clear().apply()
        _hasCreds.value = false
        _feed.value = emptyList()
        _approvals.value = emptyList()
        _state.value = AppState()
    }

    // ---- actions (client -> server) ----
    fun sendPrompt(text: String) = client.send(obj("prompt") { put("text", text) })
    fun steer(text: String) = client.send(obj("steer") { put("text", text) })
    fun interrupt() = client.send(obj("interrupt") {})
    fun resolveApproval(key: String, optionId: String) {
        client.send(obj("approval") { put("key", key); put("optionId", optionId) })
        _approvals.value = _approvals.value.filterNot { it.key == key }
    }
    fun newThread(cwd: String?) = client.send(obj("newThread") { if (!cwd.isNullOrBlank()) put("cwd", cwd) })
    fun setConfig(approvalPolicy: String?, sandbox: String?, cwd: String?) =
        client.send(obj("setConfig") {
            approvalPolicy?.let { put("approvalPolicy", it) }
            sandbox?.let { put("sandbox", it) }
            if (!cwd.isNullOrBlank()) put("cwd", cwd)
        })

    private inline fun obj(type: String, build: JSONObject.() -> Unit) =
        JSONObject().put("type", type).apply(build)

    // ---- inbound (server -> client) ----
    private fun handle(m: JSONObject) {
        when (m.optString("type")) {
            "hello" -> {
                parseState(m.optJSONObject("state"))
                _feed.value = parseEvents(m.optJSONArray("recentEvents"))
                _approvals.value = parseApprovals(m.optJSONArray("pendingApprovals"))
                liveAssistantId = null
            }
            "state" -> parseState(m.optJSONObject("state"))
            "event" -> parseEvent(m.optJSONObject("event"))?.let { addEvent(it) }
            "assistantDelta" -> appendAssistant(m.optString("text"))
            "approval" -> parseApproval(m.optJSONObject("approval"))?.let { a ->
                _approvals.value = listOf(a) + _approvals.value
                NotificationHelper.notifyApproval(getApplication(), a)
            }
            "approvalResolved" -> {
                val key = m.optString("key")
                _approvals.value = _approvals.value.filterNot { it.key == key }
            }
            "error" -> addEvent(FeedEvent(UUID.randomUUID().toString(), now(), "error", m.optString("message")))
        }
    }

    private fun addEvent(e: FeedEvent) {
        // Finalize a streaming assistant bubble when the full message arrives.
        if (e.kind == "item:agentMessage" && liveAssistantId != null) {
            _feed.value = _feed.value.map { if (it.id == liveAssistantId) it.copy(text = e.text) else it }
            liveAssistantId = null
            return
        }
        _feed.value = (_feed.value + e).takeLast(400)
    }

    private fun appendAssistant(delta: String) {
        val id = liveAssistantId
        if (id == null) {
            val e = FeedEvent(UUID.randomUUID().toString(), now(), "item:agentMessage", delta)
            liveAssistantId = e.id
            _feed.value = (_feed.value + e).takeLast(400)
        } else {
            _feed.value = _feed.value.map { if (it.id == id) it.copy(text = it.text + delta) else it }
        }
    }

    private fun parseState(s: JSONObject?) {
        s ?: return
        _state.value = AppState(
            codexConnected = s.optBoolean("codexConnected"),
            codexVersion = s.optStringOrNull("codexVersion"),
            threadId = s.optStringOrNull("threadId"),
            turnId = s.optStringOrNull("turnId"),
            cwd = s.optString("cwd", "—"),
            status = s.optString("status", "idle"),
            model = s.optStringOrNull("model"),
            approvalPolicy = s.optString("approvalPolicy", ""),
            sandbox = s.optString("sandbox", ""),
        )
    }

    private fun parseEvents(arr: JSONArray?): List<FeedEvent> {
        arr ?: return emptyList()
        val out = ArrayList<FeedEvent>(arr.length())
        for (i in 0 until arr.length()) parseEvent(arr.optJSONObject(i))?.let { out.add(it) }
        return out
    }

    private fun parseEvent(e: JSONObject?): FeedEvent? {
        e ?: return null
        return FeedEvent(
            id = e.optString("id", UUID.randomUUID().toString()),
            ts = e.optLong("ts", now()),
            kind = e.optString("kind", ""),
            text = e.optString("text", ""),
        )
    }

    private fun parseApprovals(arr: JSONArray?): List<Approval> {
        arr ?: return emptyList()
        val out = ArrayList<Approval>(arr.length())
        for (i in 0 until arr.length()) parseApproval(arr.optJSONObject(i))?.let { out.add(it) }
        return out
    }

    private fun parseApproval(a: JSONObject?): Approval? {
        a ?: return null
        val opts = ArrayList<ApprovalOption>()
        val oa = a.optJSONArray("options")
        if (oa != null) for (i in 0 until oa.length()) {
            val o = oa.optJSONObject(i) ?: continue
            opts.add(ApprovalOption(o.optString("id"), o.optString("label"), o.optString("style", "secondary")))
        }
        return Approval(
            key = a.optString("key"),
            kind = a.optString("kind"),
            title = a.optString("title"),
            command = a.optString("command"),
            cwd = a.optStringOrNull("cwd"),
            reason = a.optStringOrNull("reason"),
            note = a.optStringOrNull("note"),
            options = opts,
        )
    }

    private fun now() = System.currentTimeMillis()
}

private fun JSONObject.optStringOrNull(key: String): String? =
    if (isNull(key) || !has(key)) null else optString(key, "").ifEmpty { null }
