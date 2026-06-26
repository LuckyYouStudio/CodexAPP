// Core relay connection: WebSocket to the PC relay, reconnect, message
// dispatch into React state, outbound actions, and approval notifications.
// Speaks the protocol in PROTOCOL.md. The phone never sees Codex creds.
import { useEffect, useRef, useState, useCallback } from "react";
import { Vibration, Platform } from "react-native";
import * as Notifications from "expo-notifications";

const EVENT_CAP = 300;

// Show notifications even while the app is foregrounded.
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch {}

export async function ensureNotifPermission() {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "granted") return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.status === "granted";
  } catch {
    return false;
  }
}

function toWsUrl(httpUrl, token) {
  return httpUrl.replace(/\/+$/, "").replace(/^http/, "ws") + "/ws?token=" + encodeURIComponent(token);
}

export function useRelay(creds) {
  const { url, token } = creds || {};
  const [conn, setConn] = useState("connecting"); // connecting|open|closed|unauthorized
  const [relayState, setRelayState] = useState({});
  const [config, setConfig] = useState({ approvalPolicy: "on-request", sandbox: "workspace-write", cwd: "" });
  const [events, setEvents] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [diff, setDiff] = useState("");
  const [threads, setThreads] = useState([]);

  const wsRef = useRef(null);
  const backoffRef = useRef(1000);
  const timerRef = useRef(null);
  const aliveRef = useRef(true);

  const notifyApproval = useCallback((a) => {
    try { Vibration.vibrate(Platform.OS === "android" ? [0, 80, 40, 80] : [80, 40, 80]); } catch {}
    (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== "granted") return;
        await Notifications.scheduleNotificationAsync({
          content: { title: "Codex 需要审批：" + (a.title || ""), body: (a.command || "").slice(0, 140) },
          trigger: null,
        });
      } catch {}
    })();
  }, []);

  const pushEvents = useCallback((updater) => {
    setEvents((prev) => {
      const next = updater(prev);
      return next.length > EVENT_CAP ? next.slice(next.length - EVENT_CAP) : next;
    });
  }, []);

  const handle = useCallback((m) => {
    switch (m.type) {
      case "hello":
        setRelayState(m.state || {});
        if (m.config) setConfig((c) => ({ ...c, ...m.config }));
        setEvents((m.recentEvents || []).map((e) => ({ ...e })));
        setApprovals(m.pendingApprovals || []);
        setDiff(m.diff || "");
        break;
      case "diff":
        setDiff(m.diff || "");
        break;
      case "threads":
        setThreads(m.threads || []);
        break;
      case "state":
        setRelayState(m.state || {});
        break;
      case "event":
        pushEvents((prev) => {
          // Finalize a streaming assistant bubble when the full text lands.
          if (m.event.kind === "item:agentMessage") {
            const i = prev.findIndex((e) => e.live);
            if (i >= 0) {
              const copy = prev.slice();
              copy[i] = { ...copy[i], text: m.event.text, live: false };
              return copy;
            }
          }
          return [...prev, m.event];
        });
        break;
      case "assistantDelta":
        pushEvents((prev) => {
          const i = prev.findIndex((e) => e.live);
          if (i >= 0) {
            const copy = prev.slice();
            copy[i] = { ...copy[i], text: (copy[i].text || "") + m.text };
            return copy;
          }
          return [...prev, { id: "live-" + Date.now(), ts: Date.now(), kind: "item:agentMessage", text: m.text, live: true }];
        });
        break;
      case "outputDelta":
        // not rendered in v1 to keep the feed clean
        break;
      case "approval":
        setApprovals((prev) => (prev.some((x) => x.key === m.approval.key) ? prev : [m.approval, ...prev]));
        notifyApproval(m.approval);
        break;
      case "approvalResolved":
        setApprovals((prev) => prev.filter((x) => x.key !== m.key));
        break;
      case "error":
        pushEvents((prev) => [...prev, { id: "err-" + Date.now(), ts: Date.now(), kind: "error", text: m.message }]);
        break;
    }
  }, [notifyApproval, pushEvents]);

  const connect = useCallback(() => {
    if (!url || !token) return;
    setConn("connecting");
    let ws;
    try {
      ws = new WebSocket(toWsUrl(url, token));
    } catch {
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;
    ws.onopen = () => { backoffRef.current = 1000; setConn("open"); };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      handle(m);
    };
    ws.onclose = (ev) => {
      if (!aliveRef.current) return;
      if (ev && ev.code === 4001) { setConn("unauthorized"); return; }
      setConn("closed");
      scheduleReconnect();
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }, [url, token, handle]);

  const scheduleReconnect = useCallback(() => {
    if (!aliveRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { if (aliveRef.current) connect(); }, backoffRef.current);
    backoffRef.current = Math.min(backoffRef.current * 1.6, 15000);
  }, [connect]);

  useEffect(() => {
    aliveRef.current = true;
    // reset per-connection state
    setEvents([]);
    setApprovals([]);
    setRelayState({});
    connect();
    return () => {
      aliveRef.current = false;
      clearTimeout(timerRef.current);
      try { wsRef.current && wsRef.current.close(); } catch {}
    };
  }, [url, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((obj) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }, []);

  const actions = {
    prompt: (text, cwd) => send({ type: "prompt", text, cwd }),
    steer: (text) => send({ type: "steer", text }),
    interrupt: () => send({ type: "interrupt" }),
    approve: (key, optionId) => { send({ type: "approval", key, optionId }); setApprovals((p) => p.filter((x) => x.key !== key)); },
    newThread: (cwd) => send({ type: "newThread", cwd }),
    applyConfig: (cfg) => { setConfig((c) => ({ ...c, ...cfg })); send({ type: "setConfig", ...cfg }); },
    listThreads: () => send({ type: "listThreads" }),
    resumeThread: (threadId) => send({ type: "resumeThread", threadId }),
    getState: () => send({ type: "getState" }),
    reconnectNow: () => { clearTimeout(timerRef.current); backoffRef.current = 1000; connect(); },
  };

  const connected = conn === "open" && !!relayState.codexConnected;
  return { conn, connected, relayState, config, events, approvals, diff, threads, actions };
}
