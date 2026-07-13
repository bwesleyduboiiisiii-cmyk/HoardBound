import { NextResponse } from "next/server";
import { fireGiftByCode } from "../../../lib/roomApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TikTok gift name (or our own key) -> internal gift type
const MAP = {
  "treasure box": "treasure_box", "treasure_box": "treasure_box",
  "lightning bolt": "lightning_bolt", "lightning_bolt": "lightning_bolt",
  "a shard of hope": "shard_hope", "shard of hope": "shard_hope", "shard_hope": "shard_hope",
  "chili": "dragons_breath", "dragon's breath": "dragons_breath", "dragons breath": "dragons_breath", "dragons_breath": "dragons_breath",
  "spinning soccer": "claw_swipe", "claw swipe": "claw_swipe", "claw_swipe": "claw_swipe",
  "gold boxing gloves": "tail_lash", "tail lash": "tail_lash", "tail_lash": "tail_lash",
  "rosa": "wing_gust", "wing gust": "wing_gust", "wing_gust": "wing_gust",
  "smores": "ember_storm", "s'mores": "ember_storm", "ember storm": "ember_storm", "ember_storm": "ember_storm",
  "confetti": "fireball", "fireball": "fireball",
  "panther paws": "scorch_earth", "scorched earth": "scorch_earth", "scorch_earth": "scorch_earth",
  "pirate's treasure": "pirates_treasure", "pirates treasure": "pirates_treasure", "pirates_treasure": "pirates_treasure",
  "money gun": "money_gun", "money_gun": "money_gun",
  "shell of a warrior": "warrior_shell", "warrior_shell": "warrior_shell",
  "sound spell": "sound_spell", "sound_spell": "sound_spell",
  "gold mine": "gold_mine", "gold_mine": "gold_mine",
  "lover's lock": "lovers_lock", "lovers lock": "lovers_lock", "lovers_lock": "lovers_lock",
  "baby dragon": "dragon_bite", "dragon bite": "dragon_bite", "dragon_bite": "dragon_bite",
  "meteor shower": "meteor_storm", "meteor storm": "meteor_storm", "meteor_storm": "meteor_storm", "meteor": "meteor_storm",
  "dragon flame": "dragon_flame", "dragon_flame": "dragon_flame",
  "tiktok universe": "tiktok_universe", "tiktok_universe": "tiktok_universe",
};

export async function POST(req) {
  try {
    const body = await req.json();
    const secret = process.env.GIFT_INGEST_SECRET;
    if (secret && body.secret !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const code = String(body.roomCode || body.code || "").toUpperCase();
    const key = String(body.giftType || body.gift || "").toLowerCase();
    // Known gifts fire their specific power; every OTHER gift still does a small generic effect.
    const gift = MAP[key] || (key ? "generic" : null);
    if (!code || !gift) {
      return NextResponse.json({ error: "need roomCode and a giftType" }, { status: 400 });
    }
    const quantity = Math.max(1, Math.min(50, Number(body.quantity) || 1));
    const sender = (body.sender || "A viewer").toString().slice(0, 24);
    // NOTE: gifts are always applied at RANDOM inside the engine. We deliberately pass
    // only the sender's name — never a target — so a viewer can't pick who benefits.
    let last = null;
    for (let i = 0; i < quantity; i++) last = await fireGiftByCode(code, gift, { senderName: sender });
    return NextResponse.json({ ok: true, gift, quantity, result: last });
  } catch (e) {
    return NextResponse.json({ error: String((e && e.message) || e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, usage: "POST { roomCode, giftType, sender?, quantity?, secret? }" });
}
