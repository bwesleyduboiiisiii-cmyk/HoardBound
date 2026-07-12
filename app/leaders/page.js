"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getLeaders } from "../../lib/roomApi";
import { fmt } from "../../lib/game";

export default function LeadersPage() {
  const router = useRouter();
  const [rows, setRows] = useState(null);

  useEffect(() => { getLeaders(50).then(setRows).catch(() => setRows([])); }, []);

  return (
    <div className="leaders-wrap">
      <div className="topbar-row"><button className="navback" onClick={() => router.push("/")}>‹ Home</button></div>
      <div className="brand" style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 34 }}>HOARDBOUND</h1>
        <div className="mode">◆ Season Leaderboard ◆</div>
      </div>

      <div className="panel">
        {rows === null && <div className="waiting">Summoning the ledger…</div>}
        {rows && rows.length === 0 && (
          <div className="waiting">No games recorded yet. Play a match, then check back — winners are written to the ledger automatically.</div>
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
