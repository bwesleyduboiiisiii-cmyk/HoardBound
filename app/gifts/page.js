"use client";
import { useEffect, useState, useRef } from "react";
import { GIFT_ORDER, GIFT_META, GIFT_TIKTOK, GIFT_ATTACKS } from "../../lib/game";

// OBS gift-guide overlay: shows every power-up and the TikTok gift that fires it.
// URL options:
//   /gifts                 → vertical auto-scrolling column (default — for a TikTok 9:16 overlay)
//   /gifts?layout=grid     → two columns (Attacks | Blessings), landscape, shows all at once
//   /gifts?transparent=1   → transparent page background for OBS browser source
export default function GiftGuide() {
  const [layout, setLayout] = useState("scroll");
  const [transparent, setTransparent] = useState(false);
  const hRef = useRef(null);
  const hover = useRef(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setLayout(p.get("layout") || "scroll");
    setTransparent(p.get("transparent") === "1");
  }, []);
  // In transparent (OBS) mode, clear the page background too so only the banner shows.
  useEffect(() => {
    if (!transparent) return;
    const b = document.body.style.background, h = document.documentElement.style.background;
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    return () => { document.body.style.background = b; document.documentElement.style.background = h; };
  }, [transparent]);
  // Horizontal mode: gently auto-scroll, but it's a real scroll box so you can drag/wheel too.
  useEffect(() => {
    if (layout !== "horizontal") return;
    const el = hRef.current;
    if (!el) return;
    const id = setInterval(() => {
      if (hover.current) return;
      const half = el.scrollWidth / 2;
      el.scrollLeft += 1;
      if (half > 0 && el.scrollLeft >= half) el.scrollLeft -= half;
    }, 24);
    return () => clearInterval(id);
  }, [layout]);

  const attacks = GIFT_ORDER.filter((k) => GIFT_ATTACKS.has(k));
  const blessings = GIFT_ORDER.filter((k) => !GIFT_ATTACKS.has(k));

  const Card = ({ k }) => {
    const m = GIFT_META[k];
    return (
      <div className={`gcard ${GIFT_ATTACKS.has(k) ? "atk" : "bls"}`}>
        <div className="gc-emoji">{m.emoji}</div>
        <div className="gc-body">
          <div className="gc-top">
            <span className="gc-power">{m.power}</span>
            <span className="gc-coins">{m.coins.toLocaleString()} ◈</span>
          </div>
          <div className="gc-send">Send <b>{GIFT_TIKTOK[k]}</b></div>
          <div className="gc-eff">{m.blurb}</div>
        </div>
      </div>
    );
  };

  return (
    <div className={`gifts-overlay ${layout} ${transparent ? "transparent" : ""}`}>
      <div className="go-head">
        <span className="live-pill"><span className="dot" />LIVE</span>
        <h1>HOARDBOUND · POWER-UPS</h1>
        <div className="go-sub">Only these gifts change the game — every effect hits a random hunter</div>
      </div>

      {layout === "horizontal" ? (
        <div className="go-hscroll" ref={hRef}
          onMouseEnter={() => (hover.current = true)} onMouseLeave={() => (hover.current = false)}>
          <div className="go-htrack">
            {[...GIFT_ORDER, ...GIFT_ORDER].map((k, i) => <Card key={k + i} k={k} />)}
          </div>
        </div>
      ) : layout === "scroll" ? (
        <div className="go-scroll">
          <div className="go-track">
            {[...GIFT_ORDER, ...GIFT_ORDER].map((k, i) => <Card key={k + i} k={k} />)}
          </div>
        </div>
      ) : (
        <div className="go-cols">
          <div className="go-col">
            <div className="go-coltitle atk">🔥 Attacks</div>
            {attacks.map((k) => <Card key={k} k={k} />)}
          </div>
          <div className="go-col">
            <div className="go-coltitle bls">🎁 Blessings</div>
            {blessings.map((k) => <Card key={k} k={k} />)}
          </div>
        </div>
      )}
    </div>
  );
}
