// HOARDBOUND — TikTok LIVE gift bridge (v3).
// Listens to your TikTok LIVE and forwards gifts to your deployed app's
// /api/gift endpoint, which fires the in-game effect.
//
// Run:  node bridge.js <ROOM_CODE>
// (or set ROOM_CODE in .env). See README.md for setup.
//
// Extra: run with DEBUG_GIFTS=1 to print the RAW gift event so we can see
// exactly what fields TikTok is sending:
//   Windows:  set DEBUG_GIFTS=1 && node -r dotenv/config bridge.js Z7ZF8
//   Mac/Lin:  DEBUG_GIFTS=1 node -r dotenv/config bridge.js Z7ZF8

import "dotenv/config";
import { TikTokLiveConnection, WebcastEvent } from "tiktok-live-connector";

const USER   = process.env.TIKTOK_USER;                                 // your @username, WITHOUT the @
const APP    = (process.env.HOARDBOUND_URL || "").replace(/\/$/, "");   // e.g. https://your-app.vercel.app
const SECRET = process.env.GIFT_INGEST_SECRET || "";                    // must match the Vercel env var
const SIGN   = process.env.SIGN_API_KEY || process.env.EULER_API_KEY || ""; // optional free key (eulerstream.com)
const ROOM   = (process.argv[2] || process.env.ROOM_CODE || "").toUpperCase();
const DEBUG  = !!process.env.DEBUG_GIFTS;

// TikTok gift name -> our gift type. Matched case-insensitively. Add rows to enable more.
const GIFTS = {
  "gg": "treasure_box", "lightning bolt": "lightning_bolt", "a shard of hope": "shard_hope",
  "chili": "dragons_breath", "spinning soccer": "claw_swipe", "gold boxing gloves": "tail_lash",
  "rosa": "wing_gust", "smores": "ember_storm", "s'mores": "ember_storm", "confetti": "fireball",
  "panther paws": "scorch_earth", "pirate's treasure": "pirates_treasure", "money gun": "money_gun",
  "shell of a warrior": "warrior_shell", "sound spell": "sound_spell", "gold mine": "gold_mine",
  "lover's lock": "lovers_lock", "baby dragon": "dragon_bite", "meteor shower": "meteor_storm",
  "dragon flame": "dragon_flame", "tiktok universe": "tiktok_universe",
};
// Optional fallback: map by numeric giftId when the name won't resolve.
// Fill in from DEBUG_GIFTS output if a gift keeps arriving unmapped.
const GIFTS_BY_ID = {
  // 5655: "wing_gust",   // example — Rose
};

const EV_GIFT = (WebcastEvent && WebcastEvent.GIFT) || "gift";
const EV_END  = (WebcastEvent && WebcastEvent.STREAM_END) || "streamEnd";
const EV_DISC = (WebcastEvent && WebcastEvent.DISCONNECTED) || "disconnected";
const EV_CHAT = (WebcastEvent && WebcastEvent.CHAT) || "chat";

if (!USER || !APP || !ROOM) {
  console.error("Missing config. Need TIKTOK_USER, HOARDBOUND_URL and a ROOM_CODE (arg or env).");
  process.exit(1);
}

function readGiftName(d) {
  const candidates = [
    d && d.giftDetails && d.giftDetails.giftName,
    d && d.extendedGiftInfo && d.extendedGiftInfo.name,
    d && d.giftName,
    d && d.gift && d.gift.name,
    d && d.gift && d.gift.giftName,
  ];
  for (const c of candidates) {
    const s = (c == null ? "" : String(c)).trim();
    if (s && !/^(error|unknown|undefined|null)$/i.test(s)) return s; // ignore placeholder names
  }
  return "";
}
function readGiftId(d) {
  return (d && (d.giftId
    || (d.giftDetails && d.giftDetails.giftId)
    || (d.gift && (d.gift.id || d.gift.giftId))
    || (d.extendedGiftInfo && d.extendedGiftInfo.id))) || null;
}

async function post(payload, label) {
  try {
    const res = await fetch(`${APP}/api/gift`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, roomCode: ROOM, secret: SECRET }),
    });
    const data = await res.json().catch(() => ({}));
    let outcome = data.error || "ok";
    const r = data.result;
    if (r && typeof r === "object") {
      if (r.skipped) outcome = `no effect (${r.skipped})`;      // e.g. "window closed"
      else if (r.power || r.effect) outcome = `fired: ${r.power || r.effect}`;
    }
    console.log(`→ ${label} x${payload.quantity} from ${payload.sender}  [${res.status}] ${outcome}`);
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
  .then(() => console.log(`Connected to @${USER}'s LIVE. Forwarding gifts to room ${ROOM}. Leave this window open.${DEBUG ? " (DEBUG_GIFTS on)" : ""}`))
  .catch((e) => {
    console.error("connect failed:", (e && e.message) ? e.message : e);
    console.error("\nIf that mentions 'sign', 'signature', or 'rate limit': get a FREE key at https://www.eulerstream.com,");
    console.error("then add a line to your .env file:  SIGN_API_KEY=your-key-here   and run this again.");
    process.exit(1);
  });

const seenGifts = new Map();
function isDuplicate(key) {
  if (!key) return false;
  const now = Date.now();
  for (const [k, t] of seenGifts) if (now - t > 60000) seenGifts.delete(k);
  if (seenGifts.has(key)) return true;
  seenGifts.set(key, now);
  return false;
}

conn.on(EV_GIFT, (d) => {
  if (DEBUG) {
    console.log("DEBUG gift:", JSON.stringify({
      keys: Object.keys(d || {}),
      giftId: readGiftId(d),
      name: readGiftName(d),
      giftName: d && d.giftName,
      detailName: d && d.giftDetails && d.giftDetails.giftName,
      giftType: d && d.giftType,
      repeatCount: d && d.repeatCount,
      repeatEnd: d && d.repeatEnd,
      msgId: d && (d.msgId || d.messageId || (d.common && d.common.msgId) || d.id),
    }));
  }

  // Only act on the FINAL frame of a streakable gift; non-streak gifts are single-frame.
  const streakable = (d && (d.giftType === 1 || (d.gift && d.gift.type === 1)));
  if (streakable && d.repeatEnd === false) return;

  const giftId = readGiftId(d);
  const name = readGiftName(d);
  const quantity = Math.max(1, Number(d && d.repeatCount) || 1);
  const sender = (d && d.user && (d.user.uniqueId || d.user.nickname)) || (d && (d.uniqueId || d.nickname)) || "A viewer";

  const msgId = d && (d.msgId || d.messageId || (d.common && d.common.msgId) || d.id);
  const dedupeKey = msgId || `${sender}:${giftId || name || "?"}:${quantity}`;
  if (isDuplicate(dedupeKey)) return;

  const mapped = (name && GIFTS[name.toLowerCase()]) || (giftId && GIFTS_BY_ID[giftId]) || null;
  if (!mapped) {
    // Not a power-up gift — ignore it entirely. Only mapped gifts affect the game.
    console.log(`  · ignored (not a power-up): ${name || (giftId ? "#" + giftId : "unknown")} from ${sender}`);
    return;
  }
  post({ giftType: mapped, quantity, sender }, mapped);
});

conn.on(EV_CHAT, (d) => {
  const user = (d && d.user && (d.user.nickname || d.user.uniqueId)) || (d && (d.nickname || d.uniqueId)) || "viewer";
  const comment = (d && (d.comment || d.content)) || "";
  if (!comment) return;
  postChat(user, comment);
});

conn.on(EV_DISC, () => console.log("Disconnected from TikTok LIVE."));
conn.on(EV_END, () => { console.log("Stream ended."); process.exit(0); });
