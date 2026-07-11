"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getRoomByCode, getPlayers, getEvents, subscribeRoom } from "../../../lib/roomApi";
import { supabase } from "../../../lib/supabaseClient";
import { rageTier, fmt, eventText, ROUNDS, ACT_LABEL } from "../../../lib/game";

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
    case "gift": return { big: "A GIFT!", small: p.text, cls: "pact" };
    case "director": return { big: p.label, small: p.text, cls: "pact" };
    default: return null;
  }
}

export default function LivePage() {
  const params = useParams();
  const router = useRouter();
  const code = String(params.code || "").toUpperCase();
  const [room, setRoom] = useState(null);
  const [players, setPlayers] = useState([]);
  const [events, setEvents] = useState([]);
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
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  async function refresh() {
    const r = roomRef.current; if (!r?.id) return;
    const { data: fresh } = await supabase.from("rooms").select("*").eq("id", r.id).maybeSingle();
    if (fresh) setRoom(fresh);
    setPlayers(await getPlayers(r.id));
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

  // FLIP animation on the leaderboard
  const ranked = players.slice().sort((a, b) => b.gold - a.gold);
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
  const winner = ranked[0];

  return (
    <div className={`viewer ${transparent ? "transparent" : ""}`}>
      <button className="navback subtle" onClick={() => router.push("/")}>‹</button>
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
                className={`brow ${i === 0 ? "lead" : ""} ${p.scorched ? "scorched" : ""}`}>
                <div className="rank">{i + 1}</div>
                <div className="av">{p.avatar}</div>
                <div>
                  <div className="nm">{p.name}
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
          <div className="v-stage-main">
            <div className="v-dragon-col">
              <div className={`dragon ${room.rage >= 88 ? "wrath" : room.rage >= 50 ? "stir" : ""}`}>🐉</div>
              <div className="tier" style={{ color: tier.c }}>{tier.n}</div>
            </div>
            <div className="v-hoard-col">
              <div className="htop">The Hoard</div>
              <div className="hamt">{fmt(room.hoard)} ◈</div>
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
        <div className="hint">Players join at <b style={{ color: "var(--ash)" }}>/play/{code}</b></div>
        <div className="powers">🌹 <span className="k">Gift Roses</span> to bless a hunter · ☄️ <span className="k">Storm</span> to strike the greedy</div>
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
