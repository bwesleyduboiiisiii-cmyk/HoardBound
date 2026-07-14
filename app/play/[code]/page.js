"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getRoomByCode, getPlayers, joinRoom, submitMove, subscribeRoom, getEvents, setConnected, getPactOffers, getAvatarsByNames, updateAccountAvatar, renamePlayer, getMovedPlayerIds } from "../../../lib/roomApi";
import { supabase } from "../../../lib/supabaseClient";
import { rageTier, fmt, ROUNDS, rageStage } from "../../../lib/game";
import Chronicle from "../../_components/Chronicle";
import Avatar from "../../_components/Avatar";

// Resize any uploaded image to a small square data URL (keeps DB rows tiny).
function fileToAvatar(file, cb) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const s = 128, c = document.createElement("canvas");
      c.width = s; c.height = s;
      const ctx = c.getContext("2d");
      const scale = Math.max(s / img.width, s / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
      cb(c.toDataURL("image/jpeg", 0.82));
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

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
  const [now, setNow] = useState(Date.now());
  const [players, setPlayers] = useState([]);
  const [me, setMe] = useState(null);
  const [name, setName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [account, setAccount] = useState(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [avatars, setAvatars] = useState({});
  const avatarsRef = useRef({}); avatarsRef.current = avatars;
  const [err, setErr] = useState("");
  const [myMove, setMyMove] = useState(null);
  const [targeting, setTargeting] = useState(null);
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState([]);
  const [giftToast, setGiftToast] = useState(null);
  const [pactOffers, setPactOffers] = useState([]);
  const [movedIds, setMovedIds] = useState([]);
  const [denied, setDenied] = useState([]);
  const lastGift = useRef(undefined);
  const giftTimer = useRef(null);
  const roomRef = useRef(null); roomRef.current = room;
  const meRef = useRef(null); meRef.current = me;

  useEffect(() => {
    let a = null; try { a = JSON.parse(localStorage.getItem("hb_account") || "null"); } catch (e) {}
    if (!a) { router.push("/"); return; }
    setAccount(a); setName(a.username || ""); setAvatarUrl(a.avatarUrl || null);
  }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);

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
    const poll = setInterval(refresh, 9000); // safety net if realtime drops
    return () => { unsub && unsub(); clearInterval(poll); };
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

  // a fresh round means old pact denials no longer apply
  useEffect(() => { setDenied([]); }, [room?.round]);

  async function refresh() {
    const r = roomRef.current; if (!r?.id) return;
    const { data: fresh } = await supabase.from("rooms").select("*").eq("id", r.id).maybeSingle();
    if (fresh) setRoom(fresh);
    const ps = await getPlayers(r.id);
    setPlayers(ps);
    try { setMovedIds(fresh && fresh.status === "active" ? await getMovedPlayerIds(r.id, fresh.round) : []); } catch (e) {}
    // pull profile pictures from accounts by username (works even without a players.avatar_url column)
    const humanNames = ps.filter((p) => !p.is_bot).map((p) => p.name);
    if (humanNames.length) { try { setAvatars(await getAvatarsByNames(humanNames)); } catch (e) {} }
    const evs = await getEvents(r.id, 250);
    setEvents(evs);
    // gift toast + haptics on a newly-arrived gift
    const g = evs.find((e) => e.kind === "gift");
    if (g) {
      if (lastGift.current === undefined) lastGift.current = g.id; // first load: don't replay old gifts
      else if (g.id !== lastGift.current) {
        lastGift.current = g.id;
        const p = g.payload || {};
        const myName = meRef.current && meRef.current.name;
        setGiftToast({
          label: p.label || "🎁 Gift",
          text: p.effect ? `${p.effect} — ${p.text}` : p.text,
          mine: !!(myName && (p.names || []).includes(myName)),
        });
        try { if (navigator.vibrate) navigator.vibrate([40, 30, 60]); } catch (e) {}
        clearTimeout(giftTimer.current);
        giftTimer.current = setTimeout(() => setGiftToast(null), 4500);
      }
    }
    const my = meRef.current;
    if (my && fresh?.round) {
      // still in the game?
      if (!ps.find((p) => p.id === my.id)) { localStorage.removeItem("hb_player_" + code); setMe(null); return; }
      const { data: mv } = await supabase.from("moves").select("*")
        .eq("room_id", r.id).eq("player_id", my.id).eq("round", fresh.round).maybeSingle();
      setMyMove(mv || null);
      // incoming pact offers: another hunter chose Form Pact targeting me this round
      if (fresh.status === "active") {
        const { data: offers } = await supabase.from("moves").select("*")
          .eq("room_id", r.id).eq("round", fresh.round).eq("action", "pact").eq("target_id", my.id);
        setPactOffers((offers || [])
          .filter((o) => o.player_id !== my.id)
          .map((o) => { const off = ps.find((x) => x.id === o.player_id); return { id: o.player_id, name: off ? off.name : "A hunter" }; }));
      } else setPactOffers([]);
    }
  }

  async function onJoin() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { player } = await joinRoom(code, name.trim(), avatarUrl);
      localStorage.setItem("hb_player_" + code, JSON.stringify(player));
      setMe(player);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  function onChangePhoto(file) {
    fileToAvatar(file, (dataUrl) => {
      setAvatarUrl(dataUrl);
      const next = { ...(account || {}), username: name, avatarUrl: dataUrl };
      setAccount(next);
      localStorage.setItem("hb_account", JSON.stringify(next));
      if (name) updateAccountAvatar(name, dataUrl);
    });
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
  function signOut() {
    localStorage.removeItem("hb_player_" + code);
    localStorage.removeItem("hb_account");
    router.push("/");
  }
  async function saveName() {
    const clean = (nameDraft || "").trim().slice(0, 18);
    if (!clean || !me) { setEditingName(false); return; }
    try {
      await renamePlayer(me.id, clean);
      const next = { ...me, name: clean };
      setMe(next);
      localStorage.setItem("hb_player_" + code, JSON.stringify(next));
      refresh();
    } catch (e) {}
    setEditingName(false);
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
          <div className="label" style={{ marginBottom: 14, textAlign: "center" }}>Joining as</div>
          <div className="profile-edit" style={{ justifyContent: "center", flexDirection: "column", textAlign: "center" }}>
            <label className="pfp-upload" title="Tap to add or change your photo" style={{ cursor: "pointer" }}>
              {avatarUrl
                ? <img className="pfp" src={avatarUrl} alt="" style={{ width: 92, height: 92, border: "2px solid var(--gold)" }} />
                : <span className="pfp pfp-emoji" style={{ width: 92, height: 92, fontSize: 34 }}>📷</span>}
              <span className="pfp-cam">＋</span>
              <input type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onChangePhoto(f); }} />
            </label>
            <div style={{ fontFamily: "'Cinzel',serif", fontSize: 22, color: "var(--gold)", marginTop: 10 }}>{name}</div>
            <div className="note" style={{ marginTop: 2 }}>{avatarUrl ? "Tap the photo to change it" : "Tap to add a profile photo"}</div>
          </div>
          <button className="btn" style={{ marginTop: 16 }} disabled={busy || !name.trim()} onClick={onJoin}>
            {busy ? "Joining…" : "Take a Seat"}
          </button>
          <button className="pfp-clear" style={{ display: "block", margin: "12px auto 0" }} onClick={() => router.push("/")}>Not you? Switch account</button>
        </div>
      </div>
    );
  }

  const mine = players.find((p) => p.id === me.id) || me;
  const av = (p) => avatars[p.name] || p.avatar_url || (p.id === me.id ? (account && account.avatarUrl) : null);
  const ranked = players.slice().sort((a, b) => b.gold - a.gold);
  const myRank = ranked.findIndex((p) => p.id === me.id) + 1;
  const tier = rageTier(room.rage);
  const canMove = room.status === "active" && !myMove;
  const scorchedNames = new Set((events || []).filter((e) => e.kind === "scorch" && e.round === room.round).map((e) => e.payload && e.payload.name));
  const iAmScorched = scorchedNames.has(mine.name);
  const windowLeft = room.gift_window_until ? Math.max(0, Math.ceil((new Date(room.gift_window_until).getTime() - now) / 1000)) : 0;
  const liveOffers = pactOffers.filter((o) => !denied.includes(o.id) && !(myMove && myMove.action === "pact" && myMove.target_id === o.id));
  let guideTip = "";
  if (room.status === "lobby") guideTip = "We're in! Waiting for the host to begin…";
  else if (room.status === "resolving") guideTip = "Fortunes shift… let's see how it lands.";
  else if (room.status === "ended") guideTip = myRank === 1 ? "We did it — the hoard is ours! 👑" : "Good hunt. Ready for another?";
  else if (liveOffers.length) guideTip = `${liveOffers[0].name} wants to ally — accept or deny!`;
  else if (room.spell_player === me.id && !myMove && mine.gold >= 3000) guideTip = "✨ The arcane chose you — Cast a Spell for 3,000◈!";
  else if (iAmScorched) guideTip = "The dragon burned us! Lie Low to stay safe.";
  else if (!myMove) {
    if (room.rage >= 85) guideTip = "Dragon's about to blow — Lie Low is safest.";
    else if (room.rage >= 50) guideTip = "Rage is climbing. A quiet Sneak keeps it calm.";
    else guideTip = "Your move! Grab big, or Sneak safe?";
  } else guideTip = "Locked in. Hold tight for the reveal…";

  return (
    <div className="play-wrap">
      <FloatingGuide avatarUrl={av(mine)} emoji={mine.avatar} tip={guideTip} />
      {giftToast && (
        <div className={`play-gift-toast ${giftToast.mine ? "mine" : ""}`}>
          <div className="pg-label">{giftToast.label}{giftToast.mine ? " · for you!" : ""}</div>
          <div className="pg-text">{giftToast.text}</div>
        </div>
      )}
      <div className="topbar-row" style={{ display: "flex", justifyContent: "space-between" }}>
        <button className="navback" onClick={leave}>‹ Leave game</button>
        <button className="navback" onClick={signOut}>Sign out</button>
      </div>
      {windowLeft > 0 && (
        <div className="pw-banner">⚡ POWER-UP WINDOW · {windowLeft}s — send gifts now!</div>
      )}
      <div className="brand" style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 26, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <Avatar url={av(mine)} emoji={mine.avatar} size={40} />
          {editingName ? (
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input className="name-edit" autoFocus value={nameDraft} maxLength={18}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }} />
              <button className="name-btn" onClick={saveName}>✓</button>
              <button className="name-btn ghost" onClick={() => setEditingName(false)}>✕</button>
            </span>
          ) : (
            <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              {mine.name}
              <button className="name-btn" title="Change your name" onClick={() => { setNameDraft(mine.name); setEditingName(true); }}>✎</button>
            </span>
          )}
        </h1>
        <div className="mode">◆ Room {code} · Round {room.round || "—"}/{ROUNDS} ◆</div>
      </div>

      <div className={`panel mini ${iAmScorched ? "scorched" : ""}`}>
        <div className="m"><div className="k">Gold</div><div className="v">{fmt(mine.gold)}</div></div>
        <div className="m"><div className="k">Trust</div><div className="v" style={{ color: "var(--bone)" }}>{mine.trust}</div></div>
        <div className="m"><div className="k">Rank</div><div className="v" style={{ color: "var(--bone)" }}>{myRank || "—"}</div></div>
      </div>

      {(() => {
        const ally = players.find((p) => p.id === mine.pact_with);
        const dbl = room.modifiers && room.modifiers.doubleSneak && room.modifiers.doubleSneak[mine.id];
        if (!mine.warded && !ally && !dbl && !iAmScorched) return null;
        return (
          <div className="status-row">
            {iAmScorched && <span className="sbadge scorch">🔥 Scorched this round</span>}
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

      {room.status === "active" && pactOffers
        .filter((o) => !denied.includes(o.id) && !(myMove && myMove.action === "pact" && myMove.target_id === o.id))
        .map((o) => (
          <div className="panel pact-offer" key={o.id}>
            <div className="po-text">🤝 <b>{o.name}</b> offers you a pact this round.</div>
            <div className="po-actions">
              <button className="btn" onClick={() => choose("pact", o.id)}>Accept</button>
              <button className="btn ghost" onClick={() => setDenied((d) => [...d, o.id])}>Deny</button>
            </div>
          </div>
        ))}

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
              {room.spell_player === me.id && (
                <button className="act spell" disabled={mine.gold < 3000}
                  onClick={() => mine.gold >= 3000 && choose("spell")}>
                  <div className="t">✨ Cast a Spell · 3,000◈</div>
                  <div className="d">{mine.gold >= 3000 ? "A completely random arcane effect strikes!" : "Need 3,000◈ to cast."}</div>
                </button>
              )}
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
            <div key={p.id} className={`pl ${p.id === me.id ? "you" : ""} ${scorchedNames.has(p.name) ? "scorched" : ""}`}>
              <div className="av" style={{ fontSize: 14 }}>{i + 1}</div>
              <div className="who"><b><Avatar url={av(p)} emoji={p.avatar} size={22} /> {p.name}</b>
                {scorchedNames.has(p.name) && <span className="badge b-scorch">🔥</span>}
                {room.status === "active" && !p.is_bot && (movedIds.includes(p.id)
                  ? <span className="badge b-ready">✓ ready</span>
                  : <span className="badge b-waiting">… choosing</span>)}
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="g">{fmt(p.gold)} ◈</div>
                <div className="trust">Trust {p.trust}</div>
              </div>
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

// A draggable companion: the player's uploaded avatar, floating with a per-round tip.
function FloatingGuide({ avatarUrl, emoji, tip }) {
  const [pos, setPos] = useState({ x: null, y: null });
  const drag = useRef(null);
  const posRef = useRef(pos); posRef.current = pos;

  useEffect(() => {
    if (posRef.current.x === null) {
      setPos({ x: window.innerWidth - 96, y: window.innerHeight - 200 });
    }
    function onMove(e) {
      if (!drag.current) return;
      const p = e.touches ? e.touches[0] : e;
      let x = p.clientX - drag.current.dx;
      let y = p.clientY - drag.current.dy;
      x = Math.max(6, Math.min(window.innerWidth - 74, x));
      y = Math.max(6, Math.min(window.innerHeight - 74, y));
      setPos({ x, y });
      if (e.cancelable) e.preventDefault();
    }
    function onUp() { drag.current = null; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, []);

  function down(e) {
    const p = e.touches ? e.touches[0] : e;
    drag.current = { dx: p.clientX - posRef.current.x, dy: p.clientY - posRef.current.y };
  }

  if (pos.x === null) return null;
  return (
    <div className="floaty" style={{ left: pos.x, top: pos.y }} onMouseDown={down} onTouchStart={down}>
      {tip && <div className="floaty-bubble">{tip}</div>}
      <div className="floaty-av">
        {avatarUrl ? <img src={avatarUrl} alt="" /> : <span className="floaty-emoji">{emoji || "🐲"}</span>}
      </div>
      <div className="floaty-grip">⠿ drag</div>
    </div>
  );
}
