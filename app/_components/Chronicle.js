"use client";
import { eventText, feedClass } from "../../lib/game";

// Renders every event grouped by round, newest round first.
export default function Chronicle({ events }) {
  if (!events || events.length === 0) {
    return <div className="chron-empty">No moves yet — the plunder is about to begin.</div>;
  }
  const byRound = {};
  for (const e of events) {
    const r = e.round ?? 0;
    (byRound[r] = byRound[r] || []).push(e);
  }
  const rounds = Object.keys(byRound).map(Number).sort((a, b) => b - a);
  return (
    <div className="feed">
      {rounds.map((r) => (
        <div key={r} className="round-group">
          <div className="round-head">Round {r}</div>
          {byRound[r]
            .slice()
            .sort((a, b) => {
              const t = new Date(a.created_at) - new Date(b.created_at);
              return t !== 0 ? t : (a.payload?.seq ?? 0) - (b.payload?.seq ?? 0);
            })
            .map((e) => (
              <div key={e.id} className={`fcard ${feedClass(e.kind)}`}
                dangerouslySetInnerHTML={{ __html: eventText(e) }} />
            ))}
        </div>
      ))}
    </div>
  );
}
