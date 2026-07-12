import { NextResponse } from "next/server";
import { fireGiftByCode } from "../../../lib/roomApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TikTok gift name (or our own key) -> internal gift type
const MAP = {
  "rose": "rose", "finger heart": "finger_heart", "finger_heart": "finger_heart",
  "hi bear": "hi_bear", "hi_bear": "hi_bear", "doughnut": "doughnut", "donut": "doughnut",
};

export async function POST(req) {
  try {
    const body = await req.json();
    const secret = process.env.GIFT_INGEST_SECRET;
    if (secret && body.secret !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const code = String(body.roomCode || body.code || "").toUpperCase();
    const gift = MAP[String(body.giftType || body.gift || "").toLowerCase()];
    if (!code || !gift) {
      return NextResponse.json({ error: "need roomCode and a known giftType (rose|finger_heart|hi_bear|doughnut)" }, { status: 400 });
    }
    const quantity = Math.max(1, Math.min(50, Number(body.quantity) || 1));
    const sender = (body.sender || "A viewer").toString().slice(0, 24);
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
