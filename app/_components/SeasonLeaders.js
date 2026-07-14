"use client";
import { useEffect, useState } from "react";
import { getLeaders } from "../../lib/roomApi";
import { fmt } from "../../lib/game";

// Compact season leaderboard (top N by total gold). Polls so it stays current
// as games finish. Used on both the host cockpit and the live overlay.
export default function SeasonLeaders({ limit = 5, title = "◆ Season Leaders", poll = 20000 }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      getLeaders(limit)
        .then((r) => { if (alive) setRows(r || []); })
        .catch(() => { if (alive) setRows([]); });
    load();
    const t = setInterval(load, poll);
    return () => { alive = false; clearInterval(t); };
  }, [limit, poll]);

  return (
    <div className="slead">
      <div className="slead-head">{title}</div>
      {rows === null ? (
        <div className="slead-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="slead-empty">No finished games yet.</div>
      ) : (
        rows.map((r, i) => (
          <div key={r.name} className={`slead-row ${i === 0 ? "top" : ""}`}>
            <span className="sl-rank">{i === 0 ? "👑" : i + 1}</span>
            <span className="sl-name">{r.name}</span>
            <span className="sl-wins">{r.wins}W</span>
            <span className="sl-gold">{fmt(r.total_gold)} ◈</span>
          </div>
        ))
      )}
    </div>
  );
}
