"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getLeaders } from "../../lib/roomApi";
import { fmt } from "../../lib/game";

export default function LeadersPage() {
  const router = useRouter();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");

  function load() {
    setRows(null); setErr("");
    getLeaders(50).then(setRows).catch((e) => { setRows([]); setErr(e.message || String(e)); });
  }
  useEffect(() => { load(); }, []);

  const tableMissing = /relation .*leaders.* does not exist|could not find the table|schema cache/i.test(err);

  return (
    <div className="leaders-wrap">
      <div className="topbar-row" style={{ display: "flex", justifyContent: "space-between" }}>
        <button className="navback" onClick={() => router.push("/")}>‹ Home</button>
        <button className="navback" onClick={load}>↻ Refresh</button>
      </div>
      <div className="brand" style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 34 }}>HOARDBOUND</h1>
        <div className="mode">◆ Season Leaderboard ◆</div>
      </div>

      <div className="panel">
        {rows === null && <div className="waiting">Summoning the ledger…</div>}
        {rows && rows.length === 0 && !err && (
          <div className="waiting">No games recorded yet. Finish a match (play to round 12 or hit End Game) and the results are written automatically — then tap ↻ Refresh.</div>
        )}
        {rows && rows.length === 0 && err && (
          <div className="waiting" style={{ color: "#ff8a72" }}>
            {tableMissing
              ? "Leaderboard isn't set up yet. In Supabase → SQL Editor, run the leaders table migration (see below), then Refresh."
              : `Couldn't load the leaderboard: ${err}`}
          </div>
        )}
        {rows && rows.length > 0 && (
          <div className="lb">
            <div className="lb-row lb-head">
              <span className="lb-rank">#</span>
              <span className="lb-name">Hunter</span>
              <span className="lb-num">Wins</span>
              <span className="lb-num">Games</span>
              <span className="lb-num">Best</span>
              <span className="lb-num">Total ◈</span>
            </div>
            {rows.map((r, i) => (
              <div key={r.name} className={`lb-row ${i === 0 ? "top" : ""}`}>
                <span className="lb-rank">{i === 0 ? "👑" : i + 1}</span>
                <span className="lb-name">{r.name}</span>
                <span className="lb-num">{r.wins}</span>
                <span className="lb-num">{r.games}</span>
                <span className="lb-num">{fmt(r.best_gold)}</span>
                <span className="lb-num g">{fmt(r.total_gold)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="note" style={{ textAlign: "center" }}>Ranked by total gold across all games. Wins are first-place finishes.</div>
    </div>
  );
}
