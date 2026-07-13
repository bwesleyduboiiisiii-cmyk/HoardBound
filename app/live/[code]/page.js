"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getRoomByCode, getPlayers, getEvents, subscribeRoom, getAvatarsByNames, getChats } from "../../../lib/roomApi";
import { supabase } from "../../../lib/supabaseClient";
import { rageTier, fmt, eventText, ROUNDS, ACT_LABEL, rageStage, GIFT_ORDER, GIFT_META, GIFT_TIKTOK } from "../../../lib/game";
import Avatar from "../../_components/Avatar";

const feedClass = (k) =>
  k === "scorch" || k === "awaken" || k === "oath" || k === "betray_fail" ? "fire"
  : k === "pact" ? "pact" : k === "gift" ? "gift" : k === "take" ? "gold" : "";

const PHASE = { lobby: "Gathering", active: "The hunters move", resolving: "Fortunes shift", ended: "The hoard is claimed" };

function bannerFor(e) {
  const p = e.payload || {};
  switch (e.kind) {
    case "awaken": return p.victims?.length
      ? { big: "THE DRAGON AWAKENS", small: `${p.victims.join(" & ")} burned for their greed`, cls: "fire" }
      : { big: "THE DRAGON STIRS", small: "The wary slipped into shadow", cls: "fire" };
    case "oath": return { big: "OATH BROKEN", small: `⚔ ${p.from} turned on ${p.to}`, cls: "fire" };
    case "gift": {
      const who = p.sender && p.sender !== "Host" ? `🎁 ${p.sender} · ` : "";
      return { big: p.label || "A GIFT!", small: `${who}${p.effect ? `${p.effect} — ${p.text}` : p.text}`, cls: "gift" };
    }
    case "director": return { big: p.label, small: p.text, cls: "pact" };
    default: return null;
  }
}

export default function LivePage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || "").toUpperCase();
  const [room, setRoom] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [players, setPlayers] = useState([]);
  const [avatars, setAvatars] = useState({});
  const [events, setEvents] = useState([]);
  const [chats, setChats] = useState([]);
  const [banner, setBanner] = useState(null);
  const [flash, setFlash] = useState(0);
  const [transparent, setTransparent] = useState(false);
  const roomRef = useRef(null); roomRef.current = room;
  const lastEvent = useRef(null);

  const rowRefs = useRef({});
  const prevPos = useRef({});

  useEffect(() => {
    if (typeof window !== "undefined")
      setTransparent(new URLSearchParams(window.location.search).get("bg") === "transparent");
  }, []);

  useEffect(() => {
    getRoomByCode(code).then((r) => { if (r) setRoom(r); });
  }, [code]);

  useEffect(() => {
    if (!room?.id) return;
    refresh();
    const unsub = subscribeRoom(room.id, refresh);
    const poll = setInterval(refresh, 9000); // safety net if realtime drops
    return () => { unsub && unsub(); clearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  // Poll live TikTok chat for the bottom ticker.
  useEffect(() => {
    if (!room?.id) return;
    let alive = true;
    const load = async () => { try { const c = await getChats(room.id, 30); if (alive) setChats(c); } catch (e) {} };
    load();
    const t = setInterval(load, 2500);
    return () => { alive = false; clearInterval(t); };
  }, [room?.id]);

  async function refresh() {
    const r = roomRef.current; if (!r?.id) return;
    const { data: fresh } = await supabase.from("rooms").select("*").eq("id", r.id).maybeSingle();
    if (fresh) setRoom(fresh);
    const ps = await getPlayers(r.id);
    setPlayers(ps);
    try { const hn = ps.filter((p) => !p.is_bot).map((p) => p.name); if (hn.length) setAvatars(await getAvatarsByNames(hn)); } catch (e) {}
    const evs = await getEvents(r.id, 24);
    setEvents(evs);
    // fire banner on a new significant event
    const newest = evs[0];
    if (newest && newest.id !== lastEvent.current) {
      lastEvent.current = newest.id;
      const b = bannerFor(newest);
      if (b) { setBanner({ ...b, key: newest.id }); if (b.cls === "fire") setFlash((f) => f + 1);
        setTimeout(() => setBanner((cur) => (cur && cur.key === newest.id ? null : cur)), 2600); }
    }
  }

  // FLIP animation on the leaderboard (reversed while a "Turn the Table" gift is active)
  const reversed = !!(room && room.modifiers && room.modifiers.reverseLeaderboard);
  const ranked = players.slice().sort((a, b) => reversed ? a.gold - b.gold : b.gold - a.gold);
  useLayoutEffect(() => {
    Object.entries(rowRefs.current).forEach(([id, el]) => {
      if (!el) return;
      const last = el.getBoundingClientRect().top;
      const first = prevPos.current[id];
      if (first != null && first !== last) {
        el.style.transition = "none";
        el.style.transform = `translateY(${first - last}px)`;
        requestAnimationFrame(() => {
          el.style.transition = "transform .6s cubic-bezier(.2,.8,.2,1)";
          el.style.transform = "";
        });
      }
      prevPos.current[id] = last;
    });
  }, [players]);

  if (!room) return <div className="viewer"><div className="waiting" style={{ margin: "auto" }}>Waiting for the table “{code}”…</div></div>;

  const tier = rageTier(room.rage);
  const winner = players.slice().sort((a, b) => b.gold - a.gold)[0];
  const scorchedNames = new Set(
    (events || []).filter((e) => e.kind === "scorch" && e.round === room.round).map((e) => e.payload && e.payload.name)
  );
  const patrons = (() => {
    const tally = {};
    for (const e of events) if (e.kind === "gift") { const s = e.payload && e.payload.sender; if (s) tally[s] = (tally[s] || 0) + 1; }
    return Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 3);
  })();

  const windowLeft = room.gift_window_until ? Math.max(0, Math.ceil((new Date(room.gift_window_until).getTime() - now) / 1000)) : 0;

  // Narrator subtitle: latest meaningful line, plain text, for sound-off viewers.
  const sigEvents = (events || []).filter((e) => !(e.kind === "move" && ["sneak", "low", "idle"].includes(e.payload?.action)));
  const subtitleText = sigEvents[0] ? eventText(sigEvents[0]).replace(/<[^>]+>/g, "").trim() : "";
  const narr = room.narration && room.narration.text ? room.narration : null;

  return (
    <div className={`viewer ${transparent ? "transparent" : ""}`}>
      <button className="navback subtle" onClick={() => router.push("/")}>‹</button>
      {windowLeft > 0 && (
        <div className="pw-banner v">⚡ POWER-UP WINDOW · {windowLeft}s — SEND GIFTS!</div>
      )}
      <div className="v-top">
        <div className="brand">
          <span className="live-pill"><span className="dot" />LIVE</span>
          <div><h1>HOARDBOUND</h1><div className="mode">Dragon&apos;s Hoard</div></div>
        </div>
        <div className="v-round">
          <div className="r">Round {room.round || "—"} / {ROUNDS}</div>
          <div className="s">Room {code}</div>
        </div>
        <div className="v-phase">
          <div className="p">Now</div>
          <div className="pp">{PHASE[room.status] || "—"}</div>
        </div>
      </div>

      <div className="v-main">
        {/* standings */}
        <div className="card">
          <div className="chead">⚔ Standings</div>
          <div className="board">
            {ranked.map((p, i) => (
              <div key={p.id} ref={(el) => (rowRefs.current[p.id] = el)}
                className={`brow ${i === 0 ? "lead" : ""} ${scorchedNames.has(p.name) ? "scorched" : ""}`}>
                <div className="rank">{i + 1}</div>
                <div className="av"><Avatar url={avatars[p.name] || p.avatar_url} emoji={p.avatar} size={34} /></div>
                <div>
                  <div className="nm">{p.name}
                    {scorchedNames.has(p.name) && <span className="badge b-scorch">🔥 Scorched</span>}
                    {p.warded && <span className="badge b-ward">Warded</span>}
                    {p.pact_with && <span className="badge b-pact">Pact</span>}
                  </div>
                </div>
                <div className="gg"><div className="g">{fmt(p.gold)} ◈</div><div className="trust">Trust {p.trust}</div></div>
              </div>
            ))}
          </div>
        </div>

        {/* dragon */}
        <div className="card v-stage">
          <div className="v-hoard-corner">
            <div className="htop">The Hoard</div>
            <div className="hamt">{fmt(room.hoard)} ◈</div>
          </div>
          <div className="v-stage-main">
            <div className="v-dragon-col">
              <img className={`dragon-img ${rageStage(room.rage)}`} src={`/dragon-${rageStage(room.rage)}.png`} alt="dragon" />
              <div className="tier" style={{ color: tier.c }}>{tier.n}</div>
            </div>
          </div>
          <div className="ragebar"><span style={{ width: Math.min(100, room.rage) + "%" }} /></div>
          <div className="rage-cap"><span>DRAGON&apos;S RAGE</span><span>{room.rage} / 100</span></div>
        </div>

        {/* chronicle */}
        <div className="card">
          <div className="chead">📜 The Chronicle</div>
          <div className="v-feed">
            {events
              .filter((e) => !(e.kind === "move" && ["sneak", "low", "idle"].includes(e.payload?.action)))
              .map((e) => (
                <div key={e.id} className={`fcard ${feedClass(e.kind)}`} dangerouslySetInnerHTML={{ __html: eventText(e) }} />
              ))}
          </div>
        </div>
      </div>

      <div className="v-bottom">
        {patrons.length > 0 && (
          <div className="patrons">
            <span className="pk">👑 Top Patrons</span>
            {patrons.map(([nm, n]) => <span key={nm} className="patron">{nm} <b>×{n}</b></span>)}
          </div>
        )}
        <div className="hint">Players join at <b style={{ color: "var(--ash)" }}>/play/{code}</b></div>
      </div>

      {narr ? (
        <div className={`v-narration ${narr.who === "dragon" ? "dragon" : ""}`} key={narr.text}>
          <div className="vn-kicker">{narr.who === "dragon" ? "🐉 The Dragon Speaks" : "📜 The Chronicle Speaks"}</div>
          <div className="vn-text">{narr.text}</div>
        </div>
      ) : subtitleText ? (
        <div className="v-subtitle">💬 {subtitleText}</div>
      ) : null}

      <div className={`v-chat ${chats.length < 6 ? "paused" : ""}`}>
        {chats.length === 0 ? (
          <div className="v-chat-empty">💬 Live chat will appear here…</div>
        ) : (
          <div className="v-chat-track">
            {[...chats, ...(chats.length >= 6 ? chats : [])].map((c, i) => (
              <span key={c.id + "-" + i} className="v-chat-msg"><span className="u">{c.name}</span>{c.text}</span>
            ))}
          </div>
        )}
      </div>

      <div className={`flash ${flash ? "go" : ""}`} key={flash} />
      <div className="banner-layer">
        {banner && (
          <div className={`banner show ${banner.cls}`} key={banner.key}>
            <div className="big">{banner.big}</div>
            {banner.small && <div className="small">{banner.small}</div>}
          </div>
        )}
      </div>

      {room.status === "ended" && winner && (
        <div className="winner">
          <div className="crown">👑</div>
          <h2>The Hoard Is Claimed</h2>
          <div className="who">{winner.avatar} {winner.name}</div>
          <div className="amt">{fmt(winner.gold)} ◈</div>
        </div>
      )}
    </div>
  );
}
