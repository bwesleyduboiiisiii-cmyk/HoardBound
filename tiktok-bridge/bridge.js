// HOARDBOUND — TikTok LIVE gift bridge (v2).
// Listens to your TikTok LIVE and forwards Rose / Finger Heart / Hi Bear / Doughnut
// gifts to your deployed app's /api/gift endpoint, which fires the in-game effect.
//
// Run:  node bridge.js <ROOM_CODE>
// (or set ROOM_CODE in .env). See README.md for setup.

import "dotenv/config";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

const USER   = process.env.TIKTOK_USER;                                 // your @username, WITHOUT the @
const APP    = (process.env.HOARDBOUND_URL || "").replace(/\/$/, "");   // e.g. https://your-app.vercel.app
const SECRET = process.env.GIFT_INGEST_SECRET || "";                    // must match the Vercel env var
const SIGN   = process.env.SIGN_API_KEY || process.env.EULER_API_KEY || ""; // optional free key (eulerstream.com)
const ROOM   = (process.argv[2] || process.env.ROOM_CODE || "").toUpperCase();

// TikTok gift name -> our gift type. Add rows if you enable more gifts later.
const GIFTS = {
  "Treasure Box": "treasure_box", "Lightning Bolt": "lightning_bolt", "A Shard of Hope": "shard_hope",
  "Chili": "dragons_breath", "Spinning Soccer": "claw_swipe", "Gold Boxing Gloves": "tail_lash",
  "Rosa": "wing_gust", "Smores": "ember_storm", "Confetti": "fireball", "Panther Paws": "scorch_earth",
  "Pirate's Treasure": "pirates_treasure", "Money Gun": "money_gun", "Shell of a Warrior": "warrior_shell",
  "Sound Spell": "sound_spell", "Gold Mine": "gold_mine", "Lover's Lock": "lovers_lock",
  "Baby Dragon": "dragon_bite", "Meteor Shower": "meteor_storm", "Dragon Flame": "dragon_flame",
  "TikTok Universe": "tiktok_universe",
};

const EV_GIFT = (WebcastEvent && WebcastEvent.GIFT) || "gift";
const EV_END  = (WebcastEvent && WebcastEvent.STREAM_END) || "streamEnd";
const EV_DISC = (WebcastEvent && WebcastEvent.DISCONNECTED) || "disconnected";

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

async function postChat(user, text) {
  try {
    await fetch(`${APP}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomCode: ROOM, secret: SECRET, user: String(user).slice(0, 24), text: String(text).slice(0, 160) }),
    });
  } catch (e) {}
}

const conn = new TikTokLiveConnection(USER, SIGN ? { signApiKey: SIGN } : {});

conn.connect()
  .then(() => console.log(`Connected to @${USER}'s LIVE. Forwarding gifts to room ${ROOM}. Leave this window open.`))
  .catch((e) => {
    console.error("connect failed:", (e && e.message) ? e.message : e);
    console.error("\nIf that mentions 'sign', 'signature', or 'rate limit': get a FREE key at https://www.eulerstream.com,");
    console.error("then add a line to your .env file:  SIGN_API_KEY=your-key-here   and run this again.");
    process.exit(1);
  });

// De-dupe: TikTok can emit the same gift event more than once.
const seenGifts = new Map();
function isDuplicate(id) {
  if (!id) return false;
  const now = Date.now();
  for (const [k, t] of seenGifts) if (now - t > 60000) seenGifts.delete(k);
  if (seenGifts.has(id)) return true;
  seenGifts.set(id, now);
  return false;
}

conn.on(EV_GIFT, (d) => {
  // Streak gifts fire many events as the count climbs; only act on the FINAL one.
  // repeatEnd === false means "still streaking" — skip it (works whether or not giftType is set).
  if (d.repeatEnd === false) return;
  const msgId = d.msgId || d.messageId || (d.common && d.common.msgId) || d.id;
  if (isDuplicate(msgId)) return;
  const name = (d.giftDetails && d.giftDetails.giftName) || d.giftName || (d.gift && d.gift.name);
  if (!name) return;
  const mapped = GIFTS[name];
  const quantity = d.repeatCount || 1;
  const sender = (d.user && (d.user.uniqueId || d.user.nickname)) || d.uniqueId || d.nickname || "A viewer";
  // Mapped gifts fire their specific power; every other gift is forwarded too so the app's
  // generic fallback fires a small effect. Send the raw name for unmapped gifts.
  post({ giftType: mapped || name, quantity, sender });
});

// Forward live chat comments to the overlay ticker.
const EV_CHAT = (WebcastEvent && WebcastEvent.CHAT) || "chat";
conn.on(EV_CHAT, (d) => {
  const user = (d.user && (d.user.nickname || d.user.uniqueId)) || d.nickname || d.uniqueId || "viewer";
  const comment = d.comment || d.content || "";
  if (!comment) return;
  postChat(user, comment);
});

conn.on(EV_DISC, () => console.log("Disconnected from TikTok LIVE."));
conn.on(EV_END, () => { console.log("Stream ended."); process.exit(0); });
