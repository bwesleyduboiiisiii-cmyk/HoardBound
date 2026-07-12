export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE = () => process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // default "Rachel"
const DRAGON_VOICE = () => process.env.ELEVENLABS_DRAGON_VOICE_ID || VOICE(); // falls back to narrator voice
const MODEL = () => process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

async function tts(text, who) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { ok: false, status: 501, detail: "ELEVENLABS_API_KEY is not set on the server" };
  const voiceId = who === "dragon" ? DRAGON_VOICE() : VOICE();
  // the dragon gets lower stability + a touch of style for a more dramatic, monstrous read
  const settings = who === "dragon"
    ? { stability: 0.3, similarity_boost: 0.8, style: 0.5 }
    : { stability: 0.5, similarity_boost: 0.75 };
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL(), voice_settings: settings }),
  });
  if (!r.ok) return { ok: false, status: r.status, detail: (await r.text().catch(() => "")).slice(0, 300) };
  return { ok: true, status: 200, buf: await r.arrayBuffer() };
}

// GET = self-test you can open in a browser: /api/narrate
export async function GET() {
  const keySet = !!process.env.ELEVENLABS_API_KEY;
  const res = keySet ? await tts("Voice check.", "narrator").catch((e) => ({ ok: false, status: 0, detail: String(e) })) : { ok: false, status: 501, detail: "no key" };
  return Response.json({
    keySet,
    voiceId: VOICE(),
    dragonVoiceId: DRAGON_VOICE(),
    dragonVoiceSet: !!process.env.ELEVENLABS_DRAGON_VOICE_ID,
    modelId: MODEL(),
    working: res.ok,
    status: res.status,
    detail: res.ok ? "TTS reachable — audio returned" : res.detail,
  });
}

export async function POST(req) {
  let text = "", who = "narrator";
  try { ({ text, who } = await req.json()); } catch (e) {}
  if (!text) return Response.json({ error: "no text" }, { status: 400 });
  try {
    const res = await tts(text, who);
    if (!res.ok) return Response.json({ error: "tts failed", status: res.status, detail: res.detail }, { status: res.status || 502 });
    return new Response(res.buf, { status: 200, headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: String((e && e.message) || e) }, { status: 502 });
  }
}
