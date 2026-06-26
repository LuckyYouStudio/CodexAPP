package com.codexapp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.codexapp.Approval
import com.codexapp.AppState
import com.codexapp.ConnState
import com.codexapp.FeedEvent
import com.codexapp.RelayViewModel

@Composable
fun AppScreen(vm: RelayViewModel) {
    val hasCreds by vm.hasCreds.collectAsStateWithLifecycle()
    if (!hasCreds) SetupScreen(vm) else MainScreen(vm)
}

@Composable
private fun SetupScreen(vm: RelayViewModel) {
    var url by remember { mutableStateOf(vm.savedUrl.ifEmpty { "http://" }) }
    var token by remember { mutableStateOf("") }
    Box(Modifier.fillMaxSize().background(Bg).padding(24.dp), Alignment.Center) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("CodexApp", color = TextMain, fontSize = 30.sp, fontWeight = FontWeight.Bold)
            Text("远程控制电脑上的 Codex", color = Muted)
            OutlinedTextField(
                value = url, onValueChange = { url = it },
                label = { Text("中继地址") },
                placeholder = { Text("http://192.168.x.x:4123") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            )
            OutlinedTextField(
                value = token, onValueChange = { token = it },
                label = { Text("访问 Token") },
                singleLine = true, modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = { if (url.isNotBlank() && token.isNotBlank()) vm.saveAndConnect(url, token) },
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text("连接", fontSize = 17.sp) }
            Text("Token 在电脑端启动中继时打印。", color = Muted, fontSize = 13.sp)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainScreen(vm: RelayViewModel) {
    val conn by vm.conn.collectAsStateWithLifecycle()
    val state by vm.state.collectAsStateWithLifecycle()
    val feed by vm.feed.collectAsStateWithLifecycle()
    val approvals by vm.approvals.collectAsStateWithLifecycle()

    var showSettings by remember { mutableStateOf(false) }
    var input by remember { mutableStateOf("") }
    var steerMode by remember { mutableStateOf(false) }

    val listState = rememberLazyListState()
    LaunchedEffect(feed.size) {
        if (feed.isNotEmpty()) listState.animateScrollToItem(feed.size - 1)
    }

    val connected = conn == ConnState.CONNECTED && state.codexConnected
    val running = state.status == "running"

    Scaffold(
        containerColor = Bg,
        topBar = {
            Column {
                Row(
                    Modifier.fillMaxWidth().background(Bg).statusBarsPadding()
                        .padding(start = 14.dp, end = 6.dp, top = 8.dp, bottom = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(
                        Modifier.size(10.dp).clip(CircleShape)
                            .background(if (connected) Accent else Danger)
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("CodexApp", color = TextMain, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    Spacer(Modifier.weight(1f))
                    StatusPill(if (conn != ConnState.CONNECTED) connLabel(conn) else if (running) "运行中" else "空闲", running)
                    IconButton(onClick = { showSettings = true }) {
                        Icon(Icons.Filled.Settings, contentDescription = "设置", tint = TextMain)
                    }
                }
                Text(
                    cwdLine(state), color = Muted, fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace,
                    modifier = Modifier.fillMaxWidth().background(Bg).padding(start = 14.dp, bottom = 6.dp),
                )
                HorizontalDivider(color = Line)
            }
        },
        bottomBar = {
            Composer(
                input = input, onInput = { input = it },
                steerMode = steerMode, onSteer = { steerMode = it },
                running = running,
                onSend = {
                    val t = input.trim()
                    if (t.isNotEmpty()) {
                        if (steerMode) vm.steer(t) else vm.sendPrompt(t)
                        input = ""
                    }
                },
                onInterrupt = { vm.interrupt() },
            )
        },
    ) { pad ->
        Column(Modifier.padding(pad).fillMaxSize()) {
            // approvals pinned above the feed
            if (approvals.isNotEmpty()) {
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    approvals.forEach { a ->
                        ApprovalCard(a) { opt -> vm.resolveApproval(a.key, opt) }
                    }
                }
            }
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(feed, key = { it.id }) { e -> FeedRow(e) }
            }
        }
    }

    if (showSettings) {
        SettingsDialog(vm, state, onClose = { showSettings = false })
    }
}

@Composable
private fun StatusPill(text: String, running: Boolean) {
    val bg = if (running) Accent else Color.Transparent
    val fg = if (running) Color(0xFF04331E) else Muted
    Box(
        Modifier.clip(RoundedCornerShape(999.dp))
            .border(1.dp, if (running) Accent else Line, RoundedCornerShape(999.dp))
            .background(bg).padding(horizontal = 10.dp, vertical = 4.dp)
    ) { Text(text, color = fg, fontSize = 12.sp, fontWeight = if (running) FontWeight.SemiBold else FontWeight.Normal) }
}

@Composable
private fun FeedRow(e: FeedEvent) {
    when {
        e.kind == "user" -> Bubble(e.text, Surface2, "你", alignEnd = true)
        e.kind == "item:agentMessage" -> Bubble(e.text, Surface1, "Codex")
        e.kind.startsWith("item:commandExecution") -> Mono(e.text)
        e.kind == "error" -> Box(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                .border(1.dp, Danger, RoundedCornerShape(12.dp)).padding(10.dp)
        ) { Text(e.text, color = Danger) }
        e.kind == "thread" || e.kind == "turn" ->
            Text(e.text, color = Muted, fontSize = 13.sp, modifier = Modifier.fillMaxWidth().padding(2.dp))
        else -> Box(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Surface1).padding(10.dp)
        ) { Text(e.text, color = TextMain, fontSize = 14.sp) }
    }
}

@Composable
private fun Bubble(text: String, bg: Color, label: String, alignEnd: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (alignEnd) Arrangement.End else Arrangement.Start) {
        Column(
            Modifier.fillMaxWidth(0.9f).clip(RoundedCornerShape(12.dp)).background(bg).padding(10.dp)
        ) {
            Text(label, color = Muted, fontSize = 11.sp)
            Spacer(Modifier.height(2.dp))
            Text(text, color = TextMain)
        }
    }
}

@Composable
private fun Mono(text: String) {
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Color(0xFF0D1526))
            .border(1.dp, Line, RoundedCornerShape(10.dp)).padding(10.dp)
    ) { Text(text, color = TextMain, fontFamily = FontFamily.Monospace, fontSize = 13.sp) }
}

@Composable
private fun ApprovalCard(a: Approval, onChoose: (String) -> Unit) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Surface1)
            .border(1.dp, Warn, RoundedCornerShape(14.dp)).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("⚠ ${a.title}", color = Warn, fontWeight = FontWeight.Bold)
        Box(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Color(0xFF0D1526))
                .border(1.dp, Line, RoundedCornerShape(8.dp)).padding(10.dp)
        ) { Text(a.command, color = TextMain, fontFamily = FontFamily.Monospace, fontSize = 13.sp) }
        a.cwd?.let { Text("📁 $it", color = Muted, fontSize = 12.sp) }
        a.reason?.let { Text("💬 $it", color = Muted, fontSize = 12.sp) }
        a.note?.let { Text("⚠ $it", color = Warn, fontSize = 12.sp) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            a.options.forEach { opt ->
                val mod = Modifier.weight(1f)
                when (opt.style) {
                    "primary" -> Button(onClick = { onChoose(opt.id) }, modifier = mod) { Text(opt.label) }
                    "danger" -> OutlinedButton(
                        onClick = { onChoose(opt.id) }, modifier = mod,
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Danger)
                    ) { Text(opt.label) }
                    else -> FilledTonalButton(onClick = { onChoose(opt.id) }, modifier = mod) { Text(opt.label) }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Composer(
    input: String, onInput: (String) -> Unit,
    steerMode: Boolean, onSteer: (Boolean) -> Unit,
    running: Boolean, onSend: () -> Unit, onInterrupt: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().background(Bg).navigationBarsPadding().imePadding().padding(12.dp)) {
        HorizontalDivider(color = Line, modifier = Modifier.padding(bottom = 8.dp))
        if (running) {
            Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("任务进行中…", color = Muted, fontSize = 13.sp)
                Spacer(Modifier.weight(1f))
                OutlinedButton(
                    onClick = onInterrupt,
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Danger)
                ) { Text("停止") }
            }
        }
        Row(verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(
                value = input, onValueChange = onInput,
                placeholder = { Text("输入提示词，控制 Codex…") },
                modifier = Modifier.weight(1f), maxLines = 5,
            )
            Spacer(Modifier.width(8.dp))
            Button(onClick = onSend, modifier = Modifier.height(56.dp)) { Text("发送") }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
            Switch(checked = steerMode, onCheckedChange = onSteer)
            Spacer(Modifier.width(8.dp))
            Text("纠偏模式（插话当前任务）", color = Muted, fontSize = 13.sp)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsDialog(vm: RelayViewModel, state: AppState, onClose: () -> Unit) {
    var cwd by remember { mutableStateOf(state.cwd) }
    var policy by remember { mutableStateOf(state.approvalPolicy.ifEmpty { "on-request" }) }
    var sandbox by remember { mutableStateOf(state.sandbox.ifEmpty { "workspace-write" }) }

    AlertDialog(
        onDismissRequest = onClose,
        confirmButton = {
            TextButton(onClick = { vm.setConfig(policy, sandbox, cwd); onClose() }) { Text("应用") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("关闭") } },
        title = { Text("设置") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                OutlinedTextField(
                    value = cwd, onValueChange = { cwd = it },
                    label = { Text("工作目录 (cwd)") }, singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                Dropdown("审批策略", policy, listOf("on-request", "untrusted", "on-failure", "never")) { policy = it }
                Dropdown("沙箱", sandbox, listOf("workspace-write", "read-only", "danger-full-access")) { sandbox = it }
                OutlinedButton(onClick = { vm.newThread(cwd); onClose() }, modifier = Modifier.fillMaxWidth()) {
                    Text("新建会话")
                }
                OutlinedButton(
                    onClick = { vm.forget(); onClose() }, modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Danger)
                ) { Text("退出/忘记连接") }
            }
        },
        containerColor = Surface1,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Dropdown(label: String, value: String, options: List<String>, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }) {
        OutlinedTextField(
            value = value, onValueChange = {}, readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { opt ->
                DropdownMenuItem(text = { Text(opt) }, onClick = { onPick(opt); open = false })
            }
        }
    }
}

private fun connLabel(c: ConnState) = when (c) {
    ConnState.CONNECTING -> "连接中…"
    ConnState.DISCONNECTED -> "已断开"
    ConnState.CONNECTED -> "已连接"
}

private fun cwdLine(s: AppState): String {
    val parts = mutableListOf(s.cwd)
    if (!s.model.isNullOrEmpty()) parts.add(s.model!!)
    if (s.approvalPolicy.isNotEmpty()) parts.add(s.approvalPolicy)
    return parts.joinToString("  ·  ")
}
