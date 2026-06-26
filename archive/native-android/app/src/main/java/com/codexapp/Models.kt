package com.codexapp

// Mirrors PROTOCOL.md. Kept deliberately simple (parsed from org.json).

data class AppState(
    val codexConnected: Boolean = false,
    val codexVersion: String? = null,
    val threadId: String? = null,
    val turnId: String? = null,
    val cwd: String = "—",
    val status: String = "idle",          // "idle" | "running"
    val model: String? = null,
    val approvalPolicy: String = "",
    val sandbox: String = "",
)

data class FeedEvent(
    val id: String,
    val ts: Long,
    val kind: String,
    val text: String,
)

data class ApprovalOption(val id: String, val label: String, val style: String)

data class Approval(
    val key: String,
    val kind: String,
    val title: String,
    val command: String,
    val cwd: String?,
    val reason: String?,
    val note: String?,
    val options: List<ApprovalOption>,
)

enum class ConnState { DISCONNECTED, CONNECTING, CONNECTED }
