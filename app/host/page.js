"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  createRoom, getOrCreateRoom, stableHostId, getPlayers, getEvents, getMoveCount, addBot, renamePlayer, getAvatarsByNames,
  startRound, resolveRound, fireDirector, fireGift, resetGame, endGame, removePlayer, subscribeRoom, uuid,
  setHoard, grantGold, getMovedPlayerIds, openGiftWindow, closeGiftWindow, setRoomNarration,
} from "../../lib/roomApi";
import { supabase, hasSupabase } from "../../lib/supabaseClient";
import { ROUNDS, rageTier, fmt, rageStage, GIFT_ORDER, GIFT_META, narrationLine, dragonScorchLine, narrationDur, narrationIndexAt } from "../../lib/game";
import Chronicle from "../_components/Chronicle";
import Avatar from "../_components/Avatar";

const DIRECTOR = [
  ["meteor","☄️ Meteor Shower"],["double","✨ Double Rewards"],
  ["wake","🐉 Wake the Dragon"],["reverse","🔄 Reverse Standings"],
  ["curse","💀 Curse the Richest"],["bless","🕊️ Bless the Poorest"],
];

export default function HostPage() {
  const router = useRouter();
  const [hostId, setHostId] = useState(null);
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [events, setEvents] = useState([]);
  const [moveCount, setMoveCount] = useState(0);
  const [movedIds, setMovedIds] = useState([]);
  const [hoardInput, setHoardInput] = useState(50000);
  const [announce, setAnnounce] = useState(null);
  const [voiceWarn, setVoiceWarn] = useState(null);
  const voiceWarnedRef = useRef(false);
  const [voiceMode, setVoiceMode] = useState("ai"); // "ai" (ElevenLabs) | "free" (device voice)
  const [voices, setVoices] = useState([]);
  const [narrVoice, setNarrVoice] = useState("");
  const [dragVoice, setDragVoice] = useState("");
  const [voicePanel, setVoicePanel] = useState(false);
  const announcedRound = useRef(0);
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [gift, setGift] = useState(null);
  const [botName, setBotName] = useState("");
  const [giftQty, setGiftQty] = useState(1);
  const [avatars, setAvatars] = useState({});
  const [narration, setNarration] = useState(null);
  const [auto, setAuto] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [timerIdx, setTimerIdx] = useState(0);
  const [windowIdx, setWindowIdx] = useState(3); // default 60s
  const [now, setNow] = useState(Date.now());
  const [countdown, setCountdown] = useState(null);
  const roomRef = useRef(null);
  roomRef.current = room;
  const stepping = useRef(false);
  const windowPendingRef = useRef(0); // secs to open the power-up window AFTER narration ends
  const spokenIdx = useRef(-1);       // last narration line the host has spoken aloud
  const shownIdx = useRef(-1);        // last narration line reflected into local state

  const SPEEDS = [
    { label: "Chill", ms: 9000 },
    { label: "Slow", ms: 6000 },
    { label: "Normal", ms: 4000 },
    { label: "Fast", ms: 2000 },
  ];
  const TIMERS = [
    { label: "Off", secs: 0 },
    { label: "20s", secs: 20 },
    { label: "30s", secs: 30 },
    { label: "45s", secs: 45 },
  ];
  const WINDOWS = [
    { label: "Off", secs: 0 },
    { label: "30s", secs: 30 },
    { label: "45s", secs: 45 },
    { label: "60s", secs: 60 },
    { label: "90s", secs: 90 },
    { label: "120s", secs: 120 },
  ];
  // boot: restore host + room
  useEffect(() => {
    let acct = null; try { acct = JSON.parse(localStorage.getItem("hb_account") || "null"); } catch (e) {}
    if (!acct) { router.push("/"); return; }
    const hid = stableHostId(acct.username);
    localStorage.setItem("hb_host", hid);
    setHostId(hid);
    const rid = localStorage.getItem("hb_room");
    if (rid) {
      supabase.from("rooms").select("*").eq("id", rid).maybeSingle().then(({ data }) => {
        if (data) { setRoom(data); }
      });
    }
    // restore saved voice prefs
    try {
      const vp = JSON.parse(localStorage.getItem("hb_voice") || "null");
      if (vp) { if (vp.mode) setVoiceMode(vp.mode); if (vp.narr) setNarrVoice(vp.narr); if (vp.drag) setDragVoice(vp.drag); }
    } catch (e) {}
  }, []);

  // Load the device's built-in voices (free, no credits). Populates async in Chrome.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const prefer = (vs, names) => {
      const en = vs.filter((v) => /^en/i.test(v.lang));
      for (const n of names) { const hit = en.find((v) => v.name.toLowerCase().includes(n)); if (hit) return hit.name; }
      return (en[0] || vs[0] || {}).name || "";
    };
    const load = () => {
      const vs = window.speechSynthesis.getVoices() || [];
      if (!vs.length) return;
      setVoices(vs.map((v) => ({ name: v.name, lang: v.lang })));
      setNarrVoice((p) => p || prefer(vs, ["natural", "google us", "aria", "jenny", "samantha", "zira", "female"]));
      setDragVoice((p) => p || prefer(vs, ["guy", "david", "daniel", "google uk english male", "male"]));
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { try { window.speechSynthesis.onvoiceschanged = null; } catch (e) {} };
  }, []);

  // persist voice prefs
  useEffect(() => {
    try { localStorage.setItem("hb_voice", JSON.stringify({ mode: voiceMode, narr: narrVoice, drag: dragVoice })); } catch (e) {}
  }, [voiceMode, narrVoice, dragVoice]);

  // subscribe when room known
  useEffect(() => {
    if (!room?.id) return;
    refresh();
    const unsub = subscribeRoom(room.id, refresh);
    const poll = setInterval(refresh, 9000); // safety net if realtime drops
    return () => { unsub && unsub(); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  async function refresh() {
    const r = roomRef.current;
    if (!r?.id) return;
    const { data: fresh } = await supabase.from("rooms").select("*").eq("id", r.id).maybeSingle();
    if (fresh) setRoom(fresh);
    const ps = await getPlayers(r.id);
    setPlayers(ps);
    const humanNames = ps.filter((p) => !p.is_bot).map((p) => p.name);
    if (humanNames.length) { try { setAvatars(await getAvatarsByNames(humanNames)); } catch (e) {} }
    setEvents(await getEvents(r.id, 250));
    if (fresh?.round) {
      setMoveCount(await getMoveCount(r.id, fresh.round));
      if (fresh.status === "active") { try { setMovedIds(await getMovedPlayerIds(r.id, fresh.round)); } catch (e) {} }
      else setMovedIds([]);
    }
  }

  async function onCreate() {
    setErr("");
    if (!hasSupabase()) {
      setErr("Supabase isn't connected yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local (or your Vercel env vars) and restart, then run supabase/schema.sql. See the README.");
      return;
    }
    setBusy(true);
    try {
      const r = await getOrCreateRoom(hostId);
      localStorage.setItem("hb_room", r.id);
      setRoom(r);
      const url = `${window.location.origin}/play/${r.code}`;
      QRCode.toDataURL(url, { margin: 1, width: 300 }).then(setQr).catch(() => {});
    } catch (e) {
      const msg = e?.message || String(e);
      if (/relation .*rooms.* does not exist/i.test(msg))
        setErr("Connected to Supabase, but the tables don't exist yet. Run supabase/schema.sql in the Supabase SQL editor.");
      else if (/api key|jwt|unauthorized|invalid/i.test(msg))
        setErr("Supabase rejected the request — double-check your project URL and anon key.");
      else
        setErr("Couldn't create a game: " + msg);
    } finally { setBusy(false); }
  }

  async function onAddBot() { await addBot(room.id, players, botName); setBotName(""); await refresh(); }
  async function onRenameBot(p) {
    const next = window.prompt(`Rename ${p.name} to:`, p.name);
    if (next && next.trim()) { await renamePlayer(p.id, next); await refresh(); }
  }
  async function onKick(p) {
    if (!window.confirm(`Remove ${p.name} from the lobby?`)) return;
    setPlayers((prev) => prev.filter((x) => x.id !== p.id));
    try { await removePlayer(p.id); } catch (e) { setErr(e.message); }
  }
  async function onGrant(p) {
    const raw = window.prompt(`Give gold to ${p.name} (use a negative number to take some away):`, "1000");
    if (raw === null) return;
    const delta = Math.round(Number(raw));
    if (!delta || Number.isNaN(delta)) return;
    setPlayers((prev) => prev.map((x) => x.id === p.id ? { ...x, gold: Math.max(0, (x.gold || 0) + delta) } : x));
    try { await grantGold(p.id, delta); await refresh(); } catch (e) { setErr(e.message); }
  }
  async function onStart() { await setRoomNarration(room.id, null); await setHoard(room.id, hoardInput); await closeGiftWindow(room.id); await startRound(room.id, 1); await refresh(); }
  async function onResolve(narrate = false) {
    if (narrate) primeAudio(); // unlock audio during this click so the ElevenLabs clip can play
    setBusy(true);
    try {
      const res = await resolveRound(room);
      const wsecs = WINDOWS[windowIdx].secs;
      const ended = !!(res && res.ended);
      await refresh();
      if (narrate && res && res.events && res.events.length) {
        // The power-up window opens only AFTER the narration finishes reading.
        startNarration(res.events, room.round, ended, ended ? 0 : wsecs);
      } else if (wsecs > 0 && !ended) {
        // No narration this round — open immediately.
        try { await openGiftWindow(room.id, wsecs); } catch (e) {}
      }
    } finally { setBusy(false); }
  }
  async function onNext() { await setRoomNarration(room.id, null); await closeGiftWindow(room.id); await startRound(room.id, room.round + 1); await refresh(); }
  async function onOpenWindow() {
    const wsecs = WINDOWS[windowIdx].secs || 20;
    try { await openGiftWindow(room.id, wsecs); await refresh(); } catch (e) { setErr(e.message); }
  }

  const audioRef = useRef(null);
  const SILENT_WAV = "data:audio/wav;base64,UklGRmQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YUABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
  function primeAudio() {
    // Called during a click gesture so the browser will allow later programmatic playback.
    // The clip is silent, so no need to mute — just play it once to unlock the element.
    try {
      if (!audioRef.current) audioRef.current = new Audio();
      const a = audioRef.current;
      a.muted = false;
      a.src = SILENT_WAV;
      const p = a.play();
      if (p && p.then) p.then(() => { try { a.pause(); a.currentTime = 0; } catch (e) {} }).catch(() => {});
    } catch (e) {}
  }
  function stopAudio() {
    try { if (audioRef.current) { audioRef.current.pause(); } } catch (e) {}
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
  }
  function fallbackSpeak(text, who, onDone) {
    try {
      if (!window.speechSynthesis) { setTimeout(onDone, 2200); return; }
      const u = new SpeechSynthesisUtterance(text);
      const wantName = who === "dragon" ? dragVoice : narrVoice;
      const vObj = (window.speechSynthesis.getVoices() || []).find((v) => v.name === wantName);
      if (vObj) u.voice = vObj;
      if (who === "dragon") { u.rate = 0.85; u.pitch = 0.2; } else { u.rate = 1.02; u.pitch = 0.95; }
      u.onend = () => onDone && onDone();
      window.speechSynthesis.speak(u);
    } catch (e) { setTimeout(onDone, 2200); }
  }
  async function speak(text, who, onDone) {
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    if (voiceMode === "free") { fallbackSpeak(text, who, onDone); return; } // free device voice, no credits
    try {
      const res = await fetch("/api/narrate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, who }) });
      if (res.ok && (res.headers.get("content-type") || "").includes("audio")) {
        const url = URL.createObjectURL(await res.blob());
        if (!audioRef.current) audioRef.current = new Audio();
        const a = audioRef.current;
        a.muted = false; a.src = url;
        a.onended = () => { URL.revokeObjectURL(url); onDone && onDone(); };
        a.onerror = () => { URL.revokeObjectURL(url); fallbackSpeak(text, who, onDone); };
        await a.play().catch(() => fallbackSpeak(text, who, onDone));
        return;
      }
      // Voice API responded but not with audio — note why so it isn't a mystery.
      let why = `status ${res.status}`;
      try { const j = await res.json(); why = j.detail || j.error || why; } catch (e) {}
      flagVoiceFallback(why);
    } catch (e) { flagVoiceFallback(String((e && e.message) || e)); }
    fallbackSpeak(text, who, onDone);
  }
  function flagVoiceFallback(reason) {
    // show a small notice once per session so the host knows the ElevenLabs voice dropped (and why)
    if (voiceWarnedRef.current) return;
    voiceWarnedRef.current = true;
    setVoiceWarn(String(reason || "").slice(0, 140));
    setTimeout(() => setVoiceWarn(null), 8000);
  }
  function startNarration(events, round, ended, windowSecs = 0) {
    const lines = [{ text: `Round ${round}. Here is how it unfolded…`, who: "narrator" }];
    events.forEach((e) => {
      const text = narrationLine(e);
      if (!text) return;
      if (e.kind === "awaken") {
        const hasVictims = e.payload && e.payload.victims && e.payload.victims.length;
        lines.push({ text: hasVictims ? "You dared to touch my hoard?! Then BURN!" : "I stir… tread carefully, little thieves.", who: "dragon" });
        lines.push({ text, who: "narrator" });
      } else if (e.kind === "scorch") {
        const nm = e.payload && e.payload.name;
        const amt = e.payload && e.payload.amount;
        lines.push({ text: dragonScorchLine(nm, amt), who: "dragon" });
      } else {
        lines.push({ text, who: "narrator" });
      }
    });
    lines.push({
      text: ended ? "And that is the final round. The hoard is claimed — what a hunt!"
        : `That wraps round ${round}. Send your power-ups now, hunters — round ${round + 1} begins in a moment…`,
      who: "narrator",
    });
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    // One immutable timeline both screens read. startedAt has a small lead so the
    // single room write can reach the overlay before the first line is due.
    const durs = lines.map((l) => narrationDur(l.text));
    const startedAt = Date.now() + 400;
    const payload = { lines, durs, startedAt, total: lines.length, i: 0 };
    windowPendingRef.current = ended ? 0 : (windowSecs || 0);
    spokenIdx.current = -1;
    shownIdx.current = -1;
    setNarration({ ...payload, ended });
    // Mirror the whole sequence to the room ONCE — the overlay derives every
    // line from the same startedAt anchor, so it stays in lockstep.
    if (room?.id) setRoomNarration(room.id, payload);
  }
  function finishNarration() {
    const wsecs = windowPendingRef.current;
    windowPendingRef.current = 0;
    const rid = roomRef.current?.id;
    // Deliberately DON'T null rooms.narration here. The overlay hides it on its
    // own once the timeline elapses, so leaving the payload in place means a
    // dropped realtime event can't wipe out a narration the overlay never saw.
    // It's cleared when the next round starts (onNext / onStart).
    if (rid && wsecs > 0) openGiftWindow(rid, wsecs).then(refresh).catch(() => {});
    setNarration(null);
  }
  function endNarration() {
    stopAudio();
    // Skip = end everywhere now: write an already-expired anchor so the overlay's
    // timeline reads as complete and it hides too (self-heals even if this drops).
    const rid = roomRef.current?.id;
    if (rid && narration && narration.lines) {
      try { setRoomNarration(rid, { ...narration, startedAt: 0, i: narration.total }); } catch (e) {}
    }
    finishNarration();
  }
  // Timeline clock: advance the caption off startedAt, speak each new line, and
  // when the sequence completes, open the power-up window. Set up once per run.
  useEffect(() => {
    if (!narration || narration.startedAt == null) { spokenIdx.current = -1; shownIdx.current = -1; return; }
    const nar = narration; // lines/durs/startedAt/total are immutable for this run
    let closed = false;
    const tick = () => {
      const idx = narrationIndexAt(nar, Date.now());
      if (idx >= nar.total) {
        if (closed) return; closed = true;
        clearInterval(iv);
        stopAudio();
        finishNarration(); // opens the window; leaves the payload for the overlay to expire
        return;
      }
      if (idx !== shownIdx.current) { shownIdx.current = idx; setNarration((n) => (n ? { ...n, i: idx } : n)); }
      if (idx !== spokenIdx.current) {
        spokenIdx.current = idx;
        const cur = nar.lines[idx];
        if (cur) speak(cur.text, cur.who, () => {});
      }
    };
    const iv = setInterval(tick, 200);
    tick();
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narration && narration.startedAt]);

  // When every human has submitted their move, the narrator calls it out (once per round).
  useEffect(() => {
    if (!room || room.status !== "active") return;
    const humanCount = players.filter((p) => !p.is_bot).length;
    if (humanCount > 0 && moveCount >= humanCount && announcedRound.current !== room.round) {
      announcedRound.current = room.round;
      const opts = [
        "Every hunter has locked in their move.",
        "All moves are cast — the reckoning nears.",
        "The hunters have chosen. Resolve when you're ready.",
        "That's everyone in. The fates are set for this round.",
      ];
      const line = opts[Math.floor(Math.random() * opts.length)];
      setAnnounce(line);
      speak(line, "narrator", () => {});
      setTimeout(() => setAnnounce(null), 4500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room && room.status, room && room.round, moveCount, players.length]);

  // 1-second clock for the power-up window countdown.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const windowLeft = room && room.gift_window_until
    ? Math.max(0, Math.ceil((new Date(room.gift_window_until).getTime() - now) / 1000)) : 0;

  // Autoplay: keep advancing rounds on a timer until the game ends or the host stops it.
  // The ⏲ timer, when set, decides how long autoplay waits between steps; otherwise use the speed.
  useEffect(() => {
    if (!auto || !room) return;
    if (room.status === "ended") { setAuto(false); return; }
    if (room.status !== "active" && room.status !== "resolving") return;
    if (narration) return; // wait: let the round narration finish reading before advancing
    // While resolving, hold for the power-up window so viewers get their full send time.
    if (room.status === "resolving" && windowLeft > 0) return;
    const autoDelay = TIMERS[timerIdx].secs > 0 ? TIMERS[timerIdx].secs * 1000 : SPEEDS[speedIdx].ms;
    const t = setTimeout(async () => {
      if (stepping.current) return;
      stepping.current = true;
      try {
        const r = roomRef.current;
        if (!r) return;
        if (r.status === "active") await onResolve(true); // narrate the round, then wait for it
        else if (r.status === "resolving") await onNext();
      } finally { stepping.current = false; }
    }, autoDelay);
    return () => clearTimeout(t);
  }, [auto, room && room.status, room && room.round, speedIdx, timerIdx, narration, windowLeft]);

  // Round timer: when enabled (and autoplay is off), count down and auto-resolve at 0.
  useEffect(() => {
    const secs = TIMERS[timerIdx].secs;
    if (room && room.status === "active" && secs > 0 && !auto) setCountdown(secs);
    else setCountdown(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room && room.status, room && room.round, timerIdx, auto]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      const r = roomRef.current;
      if (r && r.status === "active" && !stepping.current) {
        stepping.current = true;
        onResolve().finally(() => { stepping.current = false; });
      }
      setCountdown(null);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  async function onDirector(kind) { await fireDirector(room, kind); }
  async function onGift(type) {
    const q = Math.max(1, Math.min(50, Number(giftQty) || 1));
    let alert = null;
    for (let i = 0; i < q; i++) alert = await fireGift(room, type, { senderName: "Host" });
    setGift(q > 1 && alert ? { ...alert, line: `×${q} — ${alert.line}` } : alert);
    setTimeout(() => setGift(null), 4200);
    // "Turn the Table" reverses the overlay for 20s, then flips back on its own
    if (alert && alert.effect === "Turn the Table") {
      setTimeout(async () => {
        const r = roomRef.current;
        const mods = { ...((r && r.modifiers) || {}), reverseLeaderboard: false };
        try { await supabase.from("rooms").update({ modifiers: mods }).eq("id", r ? r.id : room.id); } catch (e) {}
      }, 20000);
    }
  }
  async function onReset() { await resetGame(room.id); setEvents([]); }
  async function onEnd() {
    if (!window.confirm("End this game now? It'll jump to the final standings.")) return;
    await endGame(room.id);
  }
  function onLeave() {
    if ((room.status === "active" || room.status === "resolving") &&
        !window.confirm("Leave this game? You can rejoin, or use End Game to finish it first.")) return;
    localStorage.removeItem("hb_room");
    setRoom(null);
  }

  function onSignOut() {
    if (!window.confirm("Sign out of your account?")) return;
    localStorage.removeItem("hb_account");
    localStorage.removeItem("hb_room");
    router.push("/");
  }

  // ---------- render ----------
  if (!room) {
    return (
      <div className="landing">
        <div className="brand"><h1>HOARDBOUND</h1><div className="sub">HOST</div><div className="mode">◆ Dragon&apos;s Hoard ◆</div></div>
        {!hasSupabase() && (
          <div className="panel" style={{ borderColor: "#7a2a24", background: "rgba(229,83,60,.08)", marginBottom: 12, textAlign: "left" }}>
            <div className="label" style={{ color: "#ff8a72" }}>⚠ Supabase not connected</div>
            <div style={{ fontSize: 13, color: "var(--ash)", marginTop: 6, lineHeight: 1.5 }}>
              This multiplayer version needs a database. Do the 5-minute setup in the README, then restart.
            </div>
          </div>
        )}
        <button className="btn" disabled={busy || !hostId} onClick={onCreate}>{busy ? "Summoning…" : "Create a Game"}</button>
        {err && <div className="panel" style={{ borderColor: "#7a2a24", background: "rgba(229,83,60,.08)", marginTop: 12, textAlign: "left", fontSize: 13, color: "#f0a58c", lineHeight: 1.5 }}>{err}</div>}
        <div className="note">Creates a room with a join code. Add bots to fill seats, share the code, then run the rounds.</div>
      </div>
    );
  }

  const joinUrl = typeof window !== "undefined" ? `${window.location.origin}/play/${room.code}` : "";
  const liveUrl = typeof window !== "undefined" ? `${window.location.origin}/live/${room.code}` : "";
  const humans = players.filter((p) => !p.is_bot).length;

  // LOBBY
  if (room.status === "lobby") {
    return (
      <div className="host-wrap" style={{ display: "flex" }}>
        <div className="brand" style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 34 }}>HOARDBOUND</h1><div className="mode">◆ Lobby ◆</div>
        </div>
        <div className="panel codebox">
          <div className="label">Room Code</div>
          <div className="code">{room.code}</div>
          {qr && <div className="qr"><img src={qr} alt="join QR" /></div>}
          <div className="note" style={{ marginTop: 12 }}>
            Players join at <b>{joinUrl}</b><br />OBS overlay: <b>{liveUrl}</b>
          </div>
        </div>
        <div className="panel">
          <div className="subbar"><span className="label">Hunters ({players.length})</span><span style={{ color: "var(--ash)", fontSize: 12 }}>{humans} human</span></div>
          <div className="players" style={{ marginTop: 10 }}>
            {players.length === 0 && <div className="waiting">No hunters yet. Add bots or share the code.</div>}
            {players.map((p) => (
              <div key={p.id} className="pl">
                <div className="av"><Avatar url={avatars[p.name] || p.avatar_url} emoji={p.avatar} size={30} /></div>
                <div className="who"><b>{p.name}{p.is_bot && <span className="badge b-bot">bot</span>}</b></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: "var(--ash)", fontSize: 12 }}>{p.is_bot ? "ready" : (p.connected === false ? "offline" : "joined")}</span>
                  {p.is_bot && <button className="kick" title={`Rename ${p.name}`} onClick={() => onRenameBot(p)}>✎</button>}
                  <button className="kick" title={`Remove ${p.name}`} onClick={() => onKick(p)}>✕</button>
                </div>
              </div>
            ))}
          </div>
          <div className="addbot-row">
            <input
              className="addbot-input"
              value={botName}
              onChange={(e) => setBotName(e.target.value.slice(0, 18))}
              placeholder="Bot name (optional)"
              maxLength={18}
              onKeyDown={(e) => e.key === "Enter" && onAddBot()}
            />
            <button className="btn ghost" style={{ width: "auto", padding: "0 20px", whiteSpace: "nowrap" }} onClick={onAddBot}>+ Add Bot</button>
          </div>
        </div>
        <div className="hoard-set">
          <div className="label">Starting Hoard</div>
          <div className="hoard-row">
            <input type="number" className="hoard-input" min={1000} step={1000} value={hoardInput}
              onChange={(e) => setHoardInput(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
            <span className="hoard-suffix">◈</span>
          </div>
          <div className="hoard-presets">
            {[25000, 50000, 100000, 250000].map((v) => (
              <button key={v} className={`chip ${hoardInput === v ? "on" : ""}`} onClick={() => setHoardInput(v)}>
                {v >= 1000 ? (v / 1000) + "k" : v}
              </button>
            ))}
          </div>
        </div>
        <button className="btn" disabled={players.length < 2 || hoardInput < 1000} onClick={onStart}>
          {players.length < 2 ? "Need 2+ hunters" : `Begin the Plunder · ${fmt(hoardInput)}◈`}
        </button>
        <div className="dock-actions">
          <button className="btn ghost" onClick={onLeave}>⟵ Leave</button>
          <button className="btn ghost" onClick={onReset}>Reset Room</button>
          <button className="btn ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    );
  }

  // COCKPIT (active / resolving / ended)
  const tier = rageTier(room.rage);
  const ranked = players.slice().sort((a, b) => b.gold - a.gold);
  const scorchedNames = new Set(
    (events || []).filter((e) => e.kind === "scorch" && e.round === room.round).map((e) => e.payload && e.payload.name)
  );
  const winner = ranked[0];

  return (
    <div className="host-wrap cockpit">
      {narration && (() => {
        const cur = narration.lines[Math.min(narration.i, narration.lines.length - 1)];
        const isDragon = cur && cur.who === "dragon";
        return (
          <div className="narration" onClick={endNarration}>
            <div className={`narr-card ${isDragon ? "dragon" : ""}`} onClick={(e) => e.stopPropagation()}>
              <div className="narr-kicker">{isDragon ? "🐉 The Dragon Speaks" : "📜 The Chronicle Speaks"}</div>
              <div className="narr-line">{cur && cur.text}</div>
              <div className="narr-foot">
                <span>{Math.min(narration.i + 1, narration.lines.length)} / {narration.lines.length}</span>
                <button className="btn ghost" onClick={endNarration}>Skip ▸</button>
              </div>
            </div>
          </div>
        );
      })()}
      {windowLeft > 0 && (
        <div className="pw-banner">⚡ POWER-UP WINDOW · {windowLeft}s — send gifts now!</div>
      )}
      {announce && (
        <div className="announce-toast">📜 {announce}</div>
      )}
      {voiceWarn && (
        <div className="voice-warn">🔇 Voice using backup — ElevenLabs said: {voiceWarn}. Check /api/narrate</div>
      )}
      {voicePanel && (
        <div className="narration" onClick={() => setVoicePanel(false)}>
          <div className="narr-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
            <div className="narr-kicker">🔊 Narration Voice</div>
            <div className="auth-tabs" style={{ marginTop: 6 }}>
              <button className={`auth-tab ${voiceMode === "ai" ? "on" : ""}`} onClick={() => setVoiceMode("ai")}>AI · ElevenLabs</button>
              <button className={`auth-tab ${voiceMode === "free" ? "on" : ""}`} onClick={() => { primeAudio(); setVoiceMode("free"); }}>Free · Device</button>
            </div>
            {voiceMode === "free" ? (
              voices.length ? (
                <div style={{ textAlign: "left", marginTop: 14 }}>
                  <div className="label">Narrator voice</div>
                  <select className="vsel" value={narrVoice} onChange={(e) => setNarrVoice(e.target.value)}>
                    {voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                  </select>
                  <div className="label" style={{ marginTop: 12 }}>Dragon voice</div>
                  <select className="vsel" value={dragVoice} onChange={(e) => setDragVoice(e.target.value)}>
                    {voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                  </select>
                  <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                    <button className="btn ghost" onClick={() => fallbackSpeak("The hunt begins. Choose wisely, hunters.", "narrator", () => {})}>▶ Test narrator</button>
                    <button className="btn ghost" onClick={() => fallbackSpeak("You dared to touch my hoard? Then burn!", "dragon", () => {})}>🐉 Test dragon</button>
                  </div>
                  <div className="note" style={{ marginTop: 12 }}>These voices come from your device/browser — free, no credits, no key. The choices depend on your OS + browser (Chrome desktop usually has the most, including natural-sounding "Google" voices).</div>
                </div>
              ) : (
                <div className="note" style={{ marginTop: 14 }}>No device voices detected here. Try Chrome on a desktop — it has the widest selection.</div>
              )
            ) : (
              <div className="note" style={{ marginTop: 14 }}>Uses your configured ElevenLabs voices (consumes credits). If a call fails, it falls back to a device voice automatically. Switch to <b>Free · Device</b> for unlimited, no-credit narration.</div>
            )}
            <div className="narr-foot"><span /><button className="btn ghost" onClick={() => setVoicePanel(false)}>Done ▸</button></div>
          </div>
        </div>
      )}
      {gift && (
        <div className="gift-toast">
          <span className="gt-emoji">{gift.emoji}</span>
          <div><div className="gt-power">{gift.power} — {gift.effect}</div><div className="gt-line">{gift.line}</div></div>
        </div>
      )}
      <div className="brand">
        <h1 style={{ fontSize: 26 }}>HOARDBOUND</h1><div className="mode">◆ Dragon&apos;s Hoard · Host ◆</div>
      </div>

      {/* left */}
      <div className="host-left">
        <div className="panel stage">
          <div className="subbar"><span>Round <b style={{ color: "var(--bone)" }}>{room.round}</b> / {ROUNDS}</span>
            <span style={{ color: "var(--gold)" }}>{room.double_next ? "✨ Double armed" : ""}</span></div>
          <img className={`dragon-img ${rageStage(room.rage)}`} src={`/dragon-${rageStage(room.rage)}.png`} alt="dragon" />
          <div className="tier" style={{ color: tier.c }}>{tier.n}</div>
          <div className="meter"><span style={{ width: Math.min(100, room.rage) + "%" }} /></div>
          <div className="meter-cap"><span>Dragon&apos;s Rage</span><span>{room.rage} / 100</span></div>
        </div>
        <div className="panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><div className="label">The Hoard</div><div style={{ fontSize: 11, color: "var(--ash)" }}>Gold left to plunder</div></div>
          <div className="g" style={{ fontFamily: "'Cinzel',serif", fontSize: 24 }}>{fmt(room.hoard)} ◈</div>
        </div>
      </div>

      {/* center: standings */}
      <div className="host-center">
        <div className="panel">
          <div className="label" style={{ marginBottom: 10 }}>Treasure Hunters</div>
          <div className="players">
            {ranked.map((p, i) => (
              <div key={p.id} className={`pl ${p.warded ? "warded" : ""} ${scorchedNames.has(p.name) ? "scorched" : ""}`}>
                <div className="av"><Avatar url={avatars[p.name] || p.avatar_url} emoji={p.avatar} size={30} /></div>
                <div className="who">
                  <b>{p.name}
                    {scorchedNames.has(p.name) && <span className="badge b-scorch">🔥 Scorched</span>}
                    {p.warded && <span className="badge b-ward">Warded</span>}
                    {p.pact_with && <span className="badge b-pact">Pact</span>}
                    {p.is_bot && <span className="badge b-bot">bot</span>}
                    {room.status === "active" && !p.is_bot && (
                      movedIds.includes(p.id)
                        ? <span className="badge b-ready">✓ ready</span>
                        : <span className="badge b-waiting">… choosing</span>
                    )}
                  </b>
                  <span className="tag">{i === 0 ? "★ leading" : `rank ${i + 1}`}</span>
                </div>
                <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8 }}>
                  <div>
                    <div className="g" style={{ fontSize: 15 }}>{fmt(p.gold)} ◈</div>
                    <div className="trust">Trust {p.trust}</div>
                  </div>
                  <button className="grant" title={`Give gold to ${p.name}`} onClick={() => onGrant(p)}>◈+</button>
                  <button className="kick" title={`Remove ${p.name}`} onClick={() => onKick(p)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* right: director + gifts + chronicle */}
      <div className="host-right">
        <div className="panel">
          <div className="label" style={{ color: "var(--amethyst)", marginBottom: 10 }}>🎬 Director</div>
          <div className="dir-grid">
            {DIRECTOR.map(([k, l]) => <button key={k} className="dir-btn" onClick={() => onDirector(k)}>{l}</button>)}
          </div>
        </div>
        <div className="panel">
          <div className="subbar" style={{ marginBottom: 10 }}>
            <span className="label" style={{ color: "var(--amethyst)" }}>🎁 Gift Power-Ups</span>
            <label className="gift-qty">×<input type="number" min="1" max="50" value={giftQty}
              onChange={(e) => setGiftQty(e.target.value === "" ? "" : Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))} /></label>
          </div>
          <div className="gift-grid">
            {GIFT_ORDER.map((t) => (
              <button key={t} className="gift-btn" onClick={() => onGift(t)} title={`${GIFT_META[t].coins}◈ · ${GIFT_META[t].blurb}`}>
                <span className="ge">{GIFT_META[t].emoji}</span>
                <span className="gt">{GIFT_META[t].power}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="panel logpanel">
          <div className="label" style={{ marginBottom: 10 }}>📜 Chronicle</div>
          <Chronicle events={events} />
        </div>
      </div>

      {/* dock: run controls */}
      <div className="host-dock">
        <div className="panel">
          {room.status === "active" && (
            <>
              <div className="subbar" style={{ marginBottom: 10 }}>
                <span className="label">Round {room.round} in play{countdown !== null && <span style={{ color: "var(--gold)", marginLeft: 8 }}>⏳ auto-resolve in 0:{String(countdown).padStart(2, "0")}</span>}</span>
                <span style={{ color: "var(--ash)", fontSize: 12 }}>{moveCount} / {humans} humans moved · bots auto</span>
              </div>
              <button className="btn" disabled={busy} onClick={() => onResolve(true)}>{busy ? "The dice fall…" : "Resolve Round"}</button>
            </>
          )}
          {room.status === "resolving" && (
            <button className="btn" onClick={onNext}>Start Round {room.round + 1}</button>
          )}
          {room.status === "ended" && winner && (
            <>
              <div style={{ textAlign: "center", marginBottom: 10 }}>
                <div className="label">Winner</div>
                <div style={{ fontFamily: "'Cinzel',serif", fontSize: 22, color: "var(--gold)" }}>👑 {winner.name} — {fmt(winner.gold)} ◈</div>
              </div>
              <button className="btn" onClick={onReset}>New Game</button>
            </>
          )}
          {(room.status === "active" || room.status === "resolving") && (
            <div className="auto-row">
              <button className={`btn ghost auto-btn ${auto ? "on" : ""}`} onClick={() => { primeAudio(); setAuto((a) => !a); }}>
                {auto ? "⏸ Autoplay ON" : "▶ Autoplay"}
              </button>
              <button className="btn ghost" onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)} title="Autoplay speed">
                ⏱ {SPEEDS[speedIdx].label}
              </button>
              <button className="btn ghost" onClick={() => setTimerIdx((i) => (i + 1) % TIMERS.length)} title="Wait time — how long autoplay pauses between steps (and auto-resolves manual rounds)">
                ⏲ {TIMERS[timerIdx].label}
              </button>
              <button className="btn ghost" onClick={() => { primeAudio(); setVoicePanel(true); }} title="Choose the narration voice">
                🔊 {voiceMode === "free" ? "Free Voice" : "AI Voice"}
              </button>
              <button className="btn ghost" onClick={() => setWindowIdx((i) => (i + 1) % WINDOWS.length)} title="How long the power-up window stays open after each round">
                ⚡ Window {WINDOWS[windowIdx].label}
              </button>
              <button className="btn ghost" onClick={onOpenWindow} title="Open the power-up window right now">
                ⚡ Open Now
              </button>
            </div>
          )}
          <div className="dock-actions">
            <button className="btn ghost" onClick={onLeave}>⟵ Leave</button>
            {(room.status === "active" || room.status === "resolving") &&
              <button className="btn ghost danger" onClick={onEnd}>⛔ End Game</button>}
            <button className="btn ghost" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </div>
    </div>
  );
}
