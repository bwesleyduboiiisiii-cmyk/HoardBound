export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { text } -> audio/mpeg from ElevenLabs.
// Requires env ELEVENLABS_API_KEY (and optional ELEVENLABS_VOICE_ID).
// If no key is set, returns 501 so the client falls back to the browser voice.
export async function POST(req) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return Response.json({ error: "no ELEVENLABS_API_KEY" }, { status: 501 });

  let text = "";
  try { ({ text } = await req.json()); } catch (e) {}
  if (!text) return Response.json({ error: "no text" }, { status: 400 });

  const voice = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // default: "Rachel"
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3 },
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return Response.json({ error: "tts failed", detail: detail.slice(0, 300) }, { status: 502 });
    }
    const buf = await r.arrayBuffer();
    return new Response(buf, { status: 200, headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (e) {
    return Response.json({ error: String((e && e.message) || e) }, { status: 502 });
  }
}
