import { NextResponse } from "next/server";
import { getRoomByCode, addChat } from "../../../lib/roomApi";

// The TikTok bridge POSTs live chat comments here; the LIVE overlay reads them for its ticker.
export async function POST(req) {
  try {
    const body = await req.json();
    const secret = process.env.GIFT_INGEST_SECRET;
    if (secret && body.secret !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const code = String(body.roomCode || body.code || "").toUpperCase();
    const user = (body.user || body.name || "viewer").toString();
    const text = (body.text || body.comment || "").toString();
    if (!code || !text.trim()) return NextResponse.json({ error: "need roomCode and text" }, { status: 400 });
    const room = await getRoomByCode(code);
    if (!room) return NextResponse.json({ error: "room not found" }, { status: 404 });
    await addChat(room.id, user, text);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
