// HOARDBOUND — TikTok LIVE gift bridge.
// Listens to your TikTok LIVE and forwards Rose / Finger Heart / Hi Bear / Doughnut
// gifts to your deployed app's /api/gift endpoint, which fires the in-game effect.
//
// Run:  node bridge.js <ROOM_CODE>
// (or set ROOM_CODE in .env). See README.md for setup.

const { WebcastPushConnection } = require("tiktok-live-connector");

const USER   = process.env.TIKTOK_USER;                 // your @username, WITHOUT the @
const APP     = (process.env.HOARDBOUND_URL || "").replace(/\/$/, ""); // e.g. https://your-app.vercel.app
const SECRET  = process.env.GIFT_INGEST_SECRET || "";   // must match the Vercel env var
const ROOM    = (process.argv[2] || process.env.ROOM_CODE || "").toUpperCase();

// TikTok gift name -> our gift type. Add rows if you enable more gifts later.
const GIFTS = { "Rose": "rose", "Finger Heart": "finger_heart", "Hi Bear": "hi_bear", "Doughnut": "doughnut" };

if (!USER || !APP || !ROOM) {
  console.error("Missing config. Need TIKTOK_USER, HOARDBOUND_URL and a ROOM_CODE (arg or env).");
  process.exit(1);
}

async function post(payload) {
  try {
    const res = await fetch(`${APP}/api/gift`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, roomCode: ROOM, secret: SECRET }),
    });
    const data = await res.json().catch(() => ({}));
    console.log(`→ ${payload.giftType} x${payload.quantity} from ${payload.sender}`, res.status, data.error || "ok");
  } catch (e) { console.error("post failed:", e.message); }
}

const conn = new WebcastPushConnection(USER);

conn.connect()
  .then((s) => console.log(`Connected to @${USER}'s LIVE (room ${s.roomId}). Forwarding gifts to room ${ROOM}.`))
  .catch((e) => { console.error("connect failed:", e); process.exit(1); });

conn.on("gift", (d) => {
  // Streakable gifts fire many events; only count when the streak ends.
  if (d.giftType === 1 && d.repeatEnd === false) return;
  const giftType = GIFTS[d.giftName];
  if (!giftType) return; // ignore gifts we don't map
  const quantity = d.repeatCount || 1;
  post({ giftType, quantity, sender: d.uniqueId || d.nickname || "A viewer" });
});

conn.on("disconnected", () => console.log("Disconnected from TikTok LIVE."));
conn.on("streamEnd", () => { console.log("Stream ended."); process.exit(0); });
