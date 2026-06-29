// Core connection hook. Two transports, same downstream handling:
//   - LAN   : direct WebSocket to the relay (url + token).
//   - Cloud : login to the broker, connect outbound, END-TO-END encrypted
//             with the PC agent (broker only relays ciphertext).
import { useEffect, useRef, useState, useCallback } from "react";
import { Vibration, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { seal, open, fingerprint, sas } from "./e2e";

const EVENT_CAP = 300;

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
} catch {}

export async function ensureNotifPermission() {
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === "granted") return true;
    return (await Notifications.requestPermissionsAsync()).status === "granted";
  } catch { return false; }
}

const stripSlash = (s) => (s || "").replace(/\/+$/, "");

export function useRelay(profile, keypair) {
  const cloud = profile?.mode === "cloud";
  const [conn, setConn] = useState("connecting"); // connecting|open|unauthorized|closed
  const [relayState, setRelayState] = useState({});
  const [config, setConfig] = useState({ approvalPolicy: "on-request", sandbox: "workspace-write", cwd: "" });
  const [events, setEvents] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [diff, setDiff] = useState("");
  const [tree, setTree] = useState({ projects: [], projectless: [] });
  const [agentFp, setAgentFp] = useState(null);
  const [paired, setPaired] = useState(false);
  const [pairError, setPairError] = useState("");
  const [membershipUntil, setMembershipUntil] = useState(0);

  const wsRef = useRef(null);
  const backoffRef = useRef(1000);
  const timerRef = useRef(null);
  const aliveRef = useRef(true);
  const agentPubRef = useRef(null);
  const authTokenRef = useRef(null);   // JWT from /api/login (used for /api/redeem)
  const membershipRef = useRef(false); // true after a membership_required block (no auto-reconnect)

  const notifyApproval = useCallback((a) => {
    try { Vibration.vibrate(Platform.OS === "android" ? [0, 80, 40, 80] : [80, 40, 80]); } catch {}
    (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== "granted") return;
        await Notifications.scheduleNotificationAsync({ content: { title: "Codex 需要审批：" + (a.title || ""), body: (a.command || "").slice(0, 140) }, trigger: null });
      } catch {}
    })();
  }, []);

  const pushEvents = useCallback((updater) => {
    setEvents((prev) => { const n = updater(prev); return n.length > EVENT_CAP ? n.slice(n.length - EVENT_CAP) : n; });
  }, []);

  // Handle a decrypted/plain CodexApp message (identical for both transports).
  const handle = useCallback((m) => {
    switch (m.type) {
      case "hello":
        setRelayState(m.state || {});
        if (m.config) setConfig((c) => ({ ...c, ...m.config }));
        setEvents((m.recentEvents || []).map((e) => ({ ...e })));
        setApprovals(m.pendingApprovals || []);
        setDiff(m.diff || "");
        break;
      case "state": setRelayState(m.state || {}); break;
      case "diff": setDiff(m.diff || ""); break;
      case "projectTree": setTree({ projects: m.projects || [], projectless: m.projectless || [] }); break;
      case "event":
        pushEvents((prev) => {
          if (m.event.kind === "item:agentMessage") {
            const i = prev.findIndex((e) => e.live);
            if (i >= 0) { const c = prev.slice(); c[i] = { ...c[i], text: m.event.text, live: false }; return c; }
          }
          return [...prev, m.event];
        });
        break;
      case "assistantDelta":
        pushEvents((prev) => {
          const i = prev.findIndex((e) => e.live);
          if (i >= 0) { const c = prev.slice(); c[i] = { ...c[i], text: (c[i].text || "") + m.text }; return c; }
          return [...prev, { id: "live-" + Date.now(), ts: Date.now(), kind: "item:agentMessage", text: m.text, live: true }];
        });
        break;
      case "approval":
        setApprovals((prev) => (prev.some((x) => x.key === m.approval.key) ? prev : [m.approval, ...prev]));
        notifyApproval(m.approval);
        break;
      case "approvalResolved": setApprovals((prev) => prev.filter((x) => x.key !== m.key)); break;
      case "error": pushEvents((prev) => [...prev, { id: "err-" + Date.now(), ts: Date.now(), kind: "error", text: m.message }]); break;
    }
  }, [notifyApproval, pushEvents]);

  const scheduleReconnect = useCallback((connectFn) => {
    if (!aliveRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { if (aliveRef.current) connectFn(); }, backoffRef.current);
    backoffRef.current = Math.min(backoffRef.current * 1.6, 15000);
  }, []);

  const connect = useCallback(async () => {
    if (!profile) return;
    setConn("connecting");
    agentPubRef.current = null; setAgentFp(null);
    let ws;
    try {
      if (cloud) {
        const res = await fetch(stripSlash(profile.brokerUrl) + "/api/login", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: profile.email, password: profile.password }),
        });
        if (res.status === 401) { setConn("unauthorized"); return; }
        if (!res.ok) { scheduleReconnect(connect); return; }
        const data = await res.json();
        const token = data.token;
        authTokenRef.current = token;
        setMembershipUntil(data.membershipUntil || 0);
        // Not a member → show the redeem screen instead of (uselessly) hitting the gate.
        if ((data.membershipUntil || 0) <= Date.now()) { membershipRef.current = true; setConn("needMembership"); return; }
        ws = new WebSocket(stripSlash(profile.brokerUrl).replace(/^http/, "ws") + "/link");
        ws.onopen = () => { backoffRef.current = 1000; ws.send(JSON.stringify({ type: "auth", token, role: "phone", pubkey: keypair.publicKey })); };
      } else {
        ws = new WebSocket(stripSlash(profile.url).replace(/^http/, "ws") + "/ws?token=" + encodeURIComponent(profile.token));
        ws.onopen = () => { backoffRef.current = 1000; setConn("open"); };
      }
    } catch { scheduleReconnect(connect); return; }

    wsRef.current = ws;
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (cloud) {
        if (m.type === "authed") { setConn("open"); if (m.peerOnline && m.peerPubkey) { agentPubRef.current = m.peerPubkey; setAgentFp(fingerprint(m.peerPubkey)); } return; }
        if (m.type === "peer") { agentPubRef.current = m.online ? m.pubkey : null; setAgentFp(m.online ? fingerprint(m.pubkey) : null); if (!m.online) { setPaired(false); setRelayState((s) => ({ ...s, codexConnected: false })); } return; }
        if (m.type === "e2e") {
          const inner = open(m, agentPubRef.current, keypair.secretKey);
          if (!inner) return;
          // Agent online but this device isn't paired -> show the pairing screen (a step AFTER login).
          if (inner.type === "needPairing") { setConn("needPairing"); return; }
          if (inner.type === "paired") {
            if (inner.ok) { setPaired(true); setPairError(""); setConn("open"); }
            else { setPairError(inner.reason || "配对码不对，请重试"); }
            return;
          }
          if (inner.type === "hello") { setPaired(true); setConn("open"); } // already-paired device auto-connects
          handle(inner);
          return;
        }
        if (m.type === "error") {
          if (m.code === "membership_required") { membershipRef.current = true; setConn("needMembership"); try { ws.close(); } catch {} return; }
          if (/token/i.test(m.message || "")) setConn("unauthorized");
          return;
        }
        return;
      }
      handle(m);
    };
    ws.onclose = (e) => {
      if (!aliveRef.current) return;
      if (membershipRef.current) return; // blocked: wait for redeem, don't reconnect
      if (e && e.code === 4001) { setConn("unauthorized"); return; }
      setConn("closed"); scheduleReconnect(connect);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }, [profile, keypair, cloud, handle, scheduleReconnect]);

  useEffect(() => {
    aliveRef.current = true;
    setEvents([]); setApprovals([]); setRelayState({}); setDiff(""); setTree({ projects: [], projectless: [] }); setPaired(false); setPairError("");
    membershipRef.current = false;
    connect();
    return () => { aliveRef.current = false; clearTimeout(timerRef.current); try { wsRef.current && wsRef.current.close(); } catch {} };
  }, [profile, keypair]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((obj) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    if (cloud) {
      if (!agentPubRef.current) return;
      ws.send(JSON.stringify({ type: "e2e", ...seal(obj, agentPubRef.current, keypair.secretKey) }));
    } else {
      ws.send(JSON.stringify(obj));
    }
  }, [cloud, keypair]);

  // Redeem a membership code via the broker (auth = the JWT from login). On
  // success, reconnect if we were blocked; otherwise just refresh status.
  const redeem = useCallback(async (code) => {
    if (!cloud) return { ok: false, error: "仅云端模式需要会员" };
    if (!authTokenRef.current) return { ok: false, error: "请先登录" };
    try {
      const res = await fetch(stripSlash(profile.brokerUrl) + "/api/redeem", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: authTokenRef.current, code }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: j.error || ("HTTP " + res.status) };
      setMembershipUntil(j.membershipUntil || 0);
      if (membershipRef.current) { membershipRef.current = false; backoffRef.current = 1000; connect(); }
      return { ok: true, membershipUntil: j.membershipUntil };
    } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
  }, [cloud, profile, connect]);

  // Send the pairing SAS for a user-entered code (from the pairing screen).
  const pair = useCallback((code) => {
    const ap = agentPubRef.current, sock = wsRef.current;
    if (!ap || !sock || sock.readyState !== 1) { setPairError("电脑端还没上线，请先在电脑端登录"); return false; }
    sock.send(JSON.stringify({ type: "e2e", ...seal({ type: "pair", tag: sas(code, ap, keypair.publicKey) }, ap, keypair.secretKey) }));
    setPairError("");
    return true;
  }, [keypair]);

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
  };

  const connected = conn === "open" && (cloud ? (!!agentPubRef.current && paired && !!relayState.codexConnected) : !!relayState.codexConnected);
  return { conn, connected, cloud, agentFp, relayState, config, events, approvals, diff, tree, actions, membershipUntil, redeem, pair, pairError };
}
