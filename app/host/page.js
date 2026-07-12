"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  createRoom, getPlayers, getEvents, getMoveCount, addBot, renamePlayer,
  startRound, resolveRound, fireDirector, fireGift, resetGame, endGame, removePlayer, subscribeRoom, uuid,
} from "../../lib/roomApi";
import { supabase, hasSupabase } from "../../lib/supabaseClient";
import { ROUNDS, rageTier, fmt, rageStage, GIFT_ORDER, GIFT_META, narrationLine } from "../../lib/game";
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
  const [qr, setQr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [gift, setGift] = useState(null);
  const [botName, setBotName] = useState("");
  const [giftQty, setGiftQty] = useState(1);
  const [narration, setNarration] = useState(null);
  const [auto, setAuto] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [timerIdx, setTimerIdx] = useState(0);
  const [countdown, setCountdown] = useState(null);
  const roomRef = useRef(null);
  roomRef.current = room;
  const stepping = useRef(false);

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
  // boot: restore host + room
  useEffect(() => {
    let acct = null; try { acct = JSON.parse(localStorage.getItem("hb_account") || "null"); } catch (e) {}
    if (!acct) { router.push("/"); return; }
    let hid = localStorage.getItem("hb_host");
    if (!hid) { hid = uuid(); localStorage.setItem("hb_host", hid); }
    setHostId(hid);
    const rid = localStorage.getItem("hb_room");
    if (rid) {
      supabase.from("rooms").select("*").eq("id", rid).maybeSingle().then(({ data }) => {
        if (data) { setRoom(data); }
      });
    }
  }, []);

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
    setPlayers(await getPlayers(r.id));
    setEvents(await getEvents(r.id, 250));
    if (fresh?.round) setMoveCount(await getMoveCount(r.id, fresh.round));
  }

  async function onCreate() {
    setErr("");
    if (!hasSupabase()) {
      setErr("Supabase isn't connected yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local (or your Vercel env vars) and restart, then run supabase/schema.sql. See the README.");
      return;
    }
    setBusy(true);
    try {
      const r = await createRoom(hostId);
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
  async function onStart() { await startRound(room.id, 1); }
  async function onResolve(narrate = false) {
    setBusy(true);
    try {
      const res = await resolveRound(room);
      await refresh();
      if (narrate && res && res.events && res.events.length) startNarration(res.events, room.round);
    } finally { setBusy(false); }
  }
  async function onNext() { await startRound(room.id, room.round + 1); await refresh(); }

  function speak(text) {
    try {
      if (!window.speechSynthesis) return;
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.03; u.pitch = 0.9;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }
  function startNarration(events, round) {
    const lines = [`Round ${round}. Here is how it unfolded…`,
      ...events.map(narrationLine).filter(Boolean)];
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    setNarration({ lines, i: 0 });
  }
  function endNarration() {
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {}
    setNarration(null);
  }
  useEffect(() => {
    if (!narration) return;
    if (narration.i >= narration.lines.length) {
      const t = setTimeout(() => setNarration(null), 1500);
      return () => clearTimeout(t);
    }
    speak(narration.lines[narration.i]);
    const t = setTimeout(() => setNarration((n) => (n ? { ...n, i: n.i + 1 } : n)), 2700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narration && narration.i]);

  // Autoplay: keep advancing rounds on a timer until the game ends or the host stops it.
  useEffect(() => {
    if (!auto || !room) return;
    if (room.status === "ended") { setAuto(false); return; }
    if (room.status !== "active" && room.status !== "resolving") return;
    const t = setTimeout(async () => {
      if (stepping.current) return;
      stepping.current = true;
      try {
        const r = roomRef.current;
        if (!r) return;
        if (r.status === "active") await onResolve();
        else if (r.status === "resolving") await onNext();
      } finally { stepping.current = false; }
    }, SPEEDS[speedIdx].ms);
    return () => clearTimeout(t);
  }, [auto, room && room.status, room && room.round, speedIdx]);

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
                <div className="av"><Avatar url={p.avatar_url} emoji={p.avatar} size={30} /></div>
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
        <button className="btn" disabled={players.length < 2} onClick={onStart}>
          {players.length < 2 ? "Need 2+ hunters" : "Begin the Plunder"}
        </button>
        <div className="dock-actions">
          <button className="btn ghost" onClick={onLeave}>⟵ Leave</button>
          <button className="btn ghost" onClick={onReset}>Reset Room</button>
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
      {narration && (
        <div className="narration" onClick={endNarration}>
          <div className="narr-card" onClick={(e) => e.stopPropagation()}>
            <div className="narr-kicker">📜 The Chronicle Speaks</div>
            <div className="narr-line">{narration.lines[Math.min(narration.i, narration.lines.length - 1)]}</div>
            <div className="narr-foot">
              <span>{Math.min(narration.i + 1, narration.lines.length)} / {narration.lines.length}</span>
              <button className="btn ghost" onClick={endNarration}>Skip ▸</button>
            </div>
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
                <div className="av"><Avatar url={p.avatar_url} emoji={p.avatar} size={30} /></div>
                <div className="who">
                  <b>{p.name}
                    {p.warded && <span className="badge b-ward">Warded</span>}
                    {p.pact_with && <span className="badge b-pact">Pact</span>}
                    {p.is_bot && <span className="badge b-bot">bot</span>}
                  </b>
                  <span className="tag">{i === 0 ? "★ leading" : `rank ${i + 1}`}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="g" style={{ fontSize: 15 }}>{fmt(p.gold)} ◈</div>
                  <div className="trust">Trust {p.trust}</div>
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
              <button className={`btn ghost auto-btn ${auto ? "on" : ""}`} onClick={() => setAuto((a) => !a)}>
                {auto ? "⏸ Autoplay ON" : "▶ Autoplay"}
              </button>
              <button className="btn ghost" onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)} title="Autoplay speed">
                ⏱ {SPEEDS[speedIdx].label}
              </button>
              <button className="btn ghost" onClick={() => setTimerIdx((i) => (i + 1) % TIMERS.length)} title="Round timer (auto-resolves)">
                ⏲ {TIMERS[timerIdx].label}
              </button>
            </div>
          )}
          <div className="dock-actions">
            <button className="btn ghost" onClick={onLeave}>⟵ Leave</button>
            {(room.status === "active" || room.status === "resolving") &&
              <button className="btn ghost danger" onClick={onEnd}>⛔ End Game</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
