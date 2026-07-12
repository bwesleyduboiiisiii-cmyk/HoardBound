"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  createRoom, getPlayers, getEvents, getMoveCount, addBot,
  startRound, resolveRound, fireDirector, resetGame, endGame, subscribeRoom, uuid,
} from "../../lib/roomApi";
import { supabase, hasSupabase } from "../../lib/supabaseClient";
import { ROUNDS, rageTier, fmt, rageStage } from "../../lib/game";
import Chronicle from "../_components/Chronicle";

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
  const roomRef = useRef(null);
  roomRef.current = room;

  // boot: restore host + room
  useEffect(() => {
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
    return unsub;
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

  async function onAddBot() { await addBot(room.id, players); }
  async function onStart() { await startRound(room.id, 1); }
  async function onResolve() {
    setBusy(true);
    try { await resolveRound(room); await refresh(); } finally { setBusy(false); }
  }
  async function onNext() { await startRound(room.id, room.round + 1); }
  async function onDirector(kind) { await fireDirector(room, kind); }
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
                <div className="av">{p.avatar}</div>
                <div className="who"><b>{p.name}{p.is_bot && <span className="badge b-bot">bot</span>}</b></div>
                <div style={{ color: "var(--ash)", fontSize: 12 }}>{p.is_bot ? "ready" : "joined"}</div>
              </div>
            ))}
          </div>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={onAddBot}>+ Add a Bot Hunter</button>
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
  const winner = ranked[0];

  return (
    <div className="host-wrap cockpit">
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
              <div key={p.id} className={`pl ${p.warded ? "warded" : ""} ${p.scorched ? "scorched" : ""}`}>
                <div className="av">{p.avatar}</div>
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

      {/* right: director + chronicle */}
      <div className="host-right">
        <div className="panel">
          <div className="label" style={{ color: "var(--amethyst)", marginBottom: 10 }}>🎬 Director</div>
          <div className="dir-grid">
            {DIRECTOR.map(([k, l]) => <button key={k} className="dir-btn" onClick={() => onDirector(k)}>{l}</button>)}
            <button className="dir-btn gift" onClick={() => onDirector("gift_roses")}>🌹 Gift: Roses</button>
            <button className="dir-btn gift" onClick={() => onDirector("gift_storm")}>☄️ Gift: Storm</button>
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
                <span className="label">Round {room.round} in play</span>
                <span style={{ color: "var(--ash)", fontSize: 12 }}>{moveCount} / {humans} humans moved · bots auto</span>
              </div>
              <button className="btn" disabled={busy} onClick={onResolve}>{busy ? "The dice fall…" : "Resolve Round"}</button>
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
