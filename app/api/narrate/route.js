export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Only ever use the voices YOU configure. No baked-in default voice.
const VOICE = () => process.env.ELEVENLABS_VOICE_ID || null;                    // narrator
const DRAGON_VOICE = () => process.env.ELEVENLABS_DRAGON_VOICE_ID || VOICE();   // dragon, else narrator
const MODEL = () => process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

async function tts(text, who) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { ok: false, status: 501, detail: "ELEVENLABS_API_KEY is not set" };
  const voiceId = who === "dragon" ? DRAGON_VOICE() : VOICE();
  if (!voiceId) return { ok: false, status: 501, detail: "No voice configured — set ELEVENLABS_VOICE_ID" };
  // Keep settings minimal and universally supported (no `style` — some voices reject it and the call fails).
  const settings = who === "dragon"
    ? { stability: 0.35, similarity_boost: 0.85 }
    : { stability: 0.5, similarity_boost: 0.75 };
  const body = JSON.stringify({ text, model_id: MODEL(), voice_settings: settings });

  let last = { ok: false, status: 0, detail: "no attempt" };
  // Retry transient failures (429 rate limit, 5xx, network) so a brief blip
  // mid-game doesn't silently drop us to the browser voice.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg" },
        body,
      });
      if (r.ok) return { ok: true, status: 200, buf: await r.arrayBuffer() };
      last = { ok: false, status: r.status, detail: (await r.text().catch(() => "")).slice(0, 300) };
      // Only retry things that might recover; 4xx like 401/404/422 won't.
      if (r.status !== 429 && r.status < 500) break;
    } catch (e) {
      last = { ok: false, status: 0, detail: String((e && e.message) || e) };
    }
    await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
  }
  return last;
}

// GET = self-test you can open in a browser: /api/narrate
export async function GET() {
  const keySet = !!process.env.ELEVENLABS_API_KEY;
  const res = keySet ? await tts("Voice check.", "narrator").catch((e) => ({ ok: false, status: 0, detail: String(e) })) : { ok: false, status: 501, detail: "no key" };
  return Response.json({
    keySet,
    voiceId: VOICE(),
    voiceIdSet: !!process.env.ELEVENLABS_VOICE_ID,
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
