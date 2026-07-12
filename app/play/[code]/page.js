"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getRoomByCode, getPlayers, joinRoom, submitMove, subscribeRoom, getEvents, setConnected } from "../../../lib/roomApi";
import { supabase } from "../../../lib/supabaseClient";
import { rageTier, fmt, ROUNDS, rageStage } from "../../../lib/game";
import Chronicle from "../../_components/Chronicle";

const MOVES = [
  ["sneak","🪙 Sneak","Take a small, safe cut."],
  ["grab","💰 Grab","Big haul, big attention."],
  ["low","🌑 Lie Low","Warded from fire & theft."],
  ["betray","🗡️ Betray","Rob a rival's stash."],
  ["pact","🤝 Form Pact","Ally up — bonus if you both hold."],
];

export default function PlayPage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || "").toUpperCase();
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [me, setMe] = useState(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [myMove, setMyMove] = useState(null);
  const [targeting, setTargeting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState([]);
  const roomRef = useRef(null); roomRef.current = room;
  const meRef = useRef(null); meRef.current = me;

  useEffect(() => {
    getRoomByCode(code).then((r) => {
      if (!r) { setErr("No game found with code " + code); return; }
      setRoom(r);
      const stored = localStorage.getItem("hb_player_" + code);
      if (stored) setMe(JSON.parse(stored));
    }).catch((e) => setErr(e.message));
  }, [code]);

  useEffect(() => {
    if (!room?.id) return;
    refresh();
    const unsub = subscribeRoom(room.id, refresh);
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, me?.id]);

  // presence: mark this player connected while their controller is open
  useEffect(() => {
    if (!me?.id) return;
    setConnected(me.id, true);
    const off = () => setConnected(me.id, false);
    window.addEventListener("pagehide", off);
    return () => { window.removeEventListener("pagehide", off); setConnected(me.id, false); };
  }, [me?.id]);

  async function refresh() {
    const r = roomRef.current; if (!r?.id) return;
    const { data: fresh } = await supabase.from("rooms").select("*").eq("id", r.id).maybeSingle();
    if (fresh) setRoom(fresh);
    const ps = await getPlayers(r.id);
    setPlayers(ps);
    setEvents(await getEvents(r.id, 250));
    const my = meRef.current;
    if (my && fresh?.round) {
      // still in the game?
      if (!ps.find((p) => p.id === my.id)) { localStorage.removeItem("hb_player_" + code); setMe(null); return; }
      const { data: mv } = await supabase.from("moves").select("*")
        .eq("room_id", r.id).eq("player_id", my.id).eq("round", fresh.round).maybeSingle();
      setMyMove(mv || null);
    }
  }

  async function onJoin() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { player } = await joinRoom(code, name.trim());
      localStorage.setItem("hb_player_" + code, JSON.stringify(player));
      setMe(player);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function choose(action, targetId = null) {
    await submitMove(room.id, me.id, room.round, action, targetId);
    setTargeting(null);
    refresh();
  }

  function leave() {
    localStorage.removeItem("hb_player_" + code);
    router.push("/");
  }

  // ---- states ----
  if (err) return <div className="play-wrap"><div className="waiting">{err}</div></div>;
  if (!room) return <div className="play-wrap"><div className="waiting">Finding the table…</div></div>;

  if (!me) {
    return (
      <div className="play-wrap">
        <div className="topbar-row"><button className="navback" onClick={() => router.push("/")}>‹ Back</button></div>
        <div className="brand" style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 30 }}>HOARDBOUND</h1><div className="mode">◆ Room {code} ◆</div>
        </div>
        <div className="panel">
          <div className="label" style={{ marginBottom: 10 }}>Enter the table</div>
          <input className="" style={{ width: "100%", background: "var(--obsidian-2)", border: "1px solid var(--stroke)",
            borderRadius: 12, color: "var(--bone)", padding: 14, fontSize: 16, fontFamily: "'Barlow'" }}
            value={name} maxLength={18} placeholder="Your hunter name"
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onJoin()} />
          <button className="btn" style={{ marginTop: 10 }} disabled={busy || !name.trim()} onClick={onJoin}>
            {busy ? "Joining…" : "Take a Seat"}
          </button>
        </div>
      </div>
    );
  }

  const mine = players.find((p) => p.id === me.id) || me;
  const ranked = players.slice().sort((a, b) => b.gold - a.gold);
  const myRank = ranked.findIndex((p) => p.id === me.id) + 1;
  const tier = rageTier(room.rage);
  const canMove = room.status === "active" && !myMove;

  return (
    <div className="play-wrap">
      <div className="topbar-row"><button className="navback" onClick={leave}>‹ Leave game</button></div>
      <div className="brand" style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 26 }}>{mine.avatar} {mine.name}</h1>
        <div className="mode">◆ Room {code} · Round {room.round || "—"}/{ROUNDS} ◆</div>
      </div>

      <div className="panel mini">
        <div className="m"><div className="k">Gold</div><div className="v">{fmt(mine.gold)}</div></div>
        <div className="m"><div className="k">Trust</div><div className="v" style={{ color: "var(--bone)" }}>{mine.trust}</div></div>
        <div className="m"><div className="k">Rank</div><div className="v" style={{ color: "var(--bone)" }}>{myRank || "—"}</div></div>
      </div>

      {(() => {
        const ally = players.find((p) => p.id === mine.pact_with);
        const dbl = room.modifiers && room.modifiers.doubleSneak && room.modifiers.doubleSneak[mine.id];
        if (!mine.warded && !ally && !dbl) return null;
        return (
          <div className="status-row">
            {mine.warded && <span className="sbadge ward">🛡 Warded</span>}
            {ally && <span className="sbadge ally">🤝 Allied with {ally.name}</span>}
            {dbl && <span className="sbadge buff">✨ Double Sneak ready</span>}
          </div>
        );
      })()}

      <div className="panel">
        <div className="rage-row">
          <img className={`dragon-mini ${rageStage(room.rage)}`} src={`/dragon-${rageStage(room.rage)}.png`} alt="dragon" />
          <div style={{ flex: 1 }}>
            <div className="subbar" style={{ marginBottom: 8 }}>
              <span className="label">Dragon&apos;s Rage</span>
              <span style={{ color: tier.c, fontFamily: "'Cinzel',serif", fontSize: 13 }}>{tier.n} · {room.rage}/100</span>
            </div>
            <div className="meter"><span style={{ width: Math.min(100, room.rage) + "%" }} /></div>
          </div>
        </div>
      </div>

      {room.status === "lobby" && <div className="panel waiting">You&apos;re in. Waiting for the host to begin…</div>}

      {canMove && (
        <div className="panel">
          <div className="label" style={{ marginBottom: 10 }}>Choose your move</div>
          {!targeting ? (
            <div className="actions">
              {MOVES.map(([a, t, d]) => (
                <button key={a} className={`act ${a}`} onClick={() => (a === "betray" || a === "pact") ? setTargeting(a) : choose(a)}>
                  <div className="t">{t}</div><div className="d">{d}</div>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "var(--ash)", marginBottom: 8 }}>
                {targeting === "pact" ? "Offer a pact to whom?" : "Rob whose stash?"}
              </div>
              <div className="players">
                {players.filter((p) => p.id !== me.id).map((p) => (
                  <button key={p.id} className="act" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                    onClick={() => choose(targeting, p.id)}>
                    <span>{p.avatar} {p.name}</span><span className="g">{fmt(p.gold)} ◈</span>
                  </button>
                ))}
              </div>
              <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setTargeting(null)}>Back</button>
            </>
          )}
        </div>
      )}

      {room.status === "active" && myMove && (
        <div className="panel locked">✓ Move locked: {myMove.action}. Waiting for the round to resolve…</div>
      )}
      {room.status === "resolving" && <div className="panel waiting">Round resolving… watch the stream.</div>}
      {room.status === "ended" && (
        <div className="panel" style={{ textAlign: "center" }}>
          <div className="label">Final</div>
          <div style={{ fontFamily: "'Cinzel',serif", fontSize: 22, color: "var(--gold)", margin: "6px 0" }}>
            {myRank === 1 ? "👑 You claimed the hoard!" : `You finished #${myRank}`}
          </div>
          <div style={{ color: "var(--ash)" }}>{fmt(mine.gold)} ◈</div>
        </div>
      )}

      <div className="panel">
        <div className="label" style={{ marginBottom: 8 }}>Standings</div>
        <div className="players">
          {ranked.map((p, i) => (
            <div key={p.id} className={`pl ${p.id === me.id ? "you" : ""}`}>
              <div className="av" style={{ fontSize: 14 }}>{i + 1}</div>
              <div className="who"><b>{p.avatar} {p.name}</b></div>
              <div className="g">{fmt(p.gold)} ◈</div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="label" style={{ marginBottom: 8 }}>📜 Chronicle</div>
        <Chronicle events={events} />
      </div>
    </div>
  );
}
