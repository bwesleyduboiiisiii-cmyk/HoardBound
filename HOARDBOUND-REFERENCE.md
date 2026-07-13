# HOARDBOUND — Quick Reference

Mode: Dragon's Hoard. Stack: Next.js 14 + Supabase + Vercel. App: https://hoard-bound.vercel.app

---

## Gift power-ups (20 named + generic fallback)

All effects hit **random** targets — a viewer can never pick who benefits or gets hit.
The "Gift (TikTok)" column is the real TikTok gift the bridge listens for; remap freely.

### Attacks

| Gift (TikTok)        | Power           | Coins  | Effect |
|----------------------|-----------------|-------:|--------|
| 🔥 Chili             | Dragon's Breath | 1      | One random hunter −25% |
| 🐾 Spinning Soccer   | Claw Swipe      | 5      | One random hunter −30% |
| 🐉 Gold Boxing Gloves| Tail Lash       | 10     | One random hunter −40% |
| 🌪️ Rosa              | Wing Gust       | 10     | Two random hunters −20% each |
| 🌋 Smores            | Ember Storm     | 25     | Random third of the lobby −20% each |
| ☄️ Confetti          | Fireball        | 100    | One random hunter −45% |
| 🔥 Panther Paws      | Scorched Earth  | 199    | Everyone −15% (non-lethal) |
| 🐲 Baby Dragon       | Dragon's Bite   | 2,000  | One random hunter −60% |
| ☄️ Meteor Shower     | Meteor Storm    | 3,000  | Random half the lobby −50% each |
| 🐉 Dragon Flame      | Dragon Flame    | 26,999 | Every hunter to 0 |

### Blessings / utility

| Gift (TikTok)        | Power            | Coins  | Effect |
|----------------------|------------------|-------:|--------|
| 📦 Treasure Box      | Treasure Box     | 1      | +400 ◈ to a random hunter |
| ⚡ Lightning Bolt    | Storm Bolt       | 1      | Feeds the dragon — Rage +8 |
| 🔷 A Shard of Hope   | Shard of Hope    | 1      | Random hunter gets a Ward or +Trust |
| 🏴‍☠️ Pirate's Treasure | Pirate's Treasure | 449   | +1,200 ◈ to a random hunter |
| 💵 Money Gun         | Money Gun        | 500    | +2,200 ◈ to a random hunter |
| 🛡️ Shell of a Warrior| Warrior's Shell  | 500    | Shields a random hunter |
| 🎵 Sound Spell       | Sound Spell      | 500    | Random hunter casts a random spell (Siphon, Lullaby, Stone, Rift, Phantom, Gamble) |
| ⛏️ Gold Mine         | Gold Mine        | 1,000  | +4,000 ◈ jackpot to a random hunter |
| 🔒 Lover's Lock      | Lover's Lock     | 1,500  | Seals a pact between two random hunters |
| 🌌 TikTok Universe   | TikTok Universe  | 44,999 | +5,000 ◈ to every hunter |

### Generic fallback
Every OTHER gift a viewer sends still fires a small random effect: a Tribute (+200 ◈ to a
random hunter), a Dragon Nibble (−8% off one hunter), or a Stirring (Rage +5). No gift is wasted.

---

## Power-up window
Viewer gifts only fire an effect while the window is **open**. It opens automatically after each
round resolves and shows a glowing countdown on host, player, and overlay screens.

Host controls: `⚡ Window <len>` cycles the length (Off / 15 / 20 / 30 / 45s), `⚡ Open Now` opens
one instantly. Host's own gift buttons always work, window or not.

---

## Host controls
- Starting Hoard chooser in the lobby (presets 25k/50k/100k/250k or type any amount).
- `◈+` per hunter to give/take gold (negative to remove).
- Move-status badges: green "✓ ready" / amber "… choosing" so you can see who hasn't picked.
- `⚡ Window` / `⚡ Open Now` power-up window.
- Voice: AI (ElevenLabs) or Free (device voices).
- Every gift power-up is also a manual host button.

---

## Deploy
1. Unzip `hoardbound-clean.zip`.
2. In GitHub Desktop, empty the repo folder, copy the new files in so `package.json`, `app/`,
   `public/`, and `tiktok-bridge/` sit at the TOP (no folder-inside-folder). Commit and push.
3. Vercel auto-deploys.

### One-time SQL (Supabase → SQL Editor), if not already run
```sql
alter table rooms add column if not exists gift_window_until timestamptz;
```
(Plus the earlier cumulative migrations in supabase/schema.sql if this is a fresh DB.)

### Vercel env vars (Settings → Environment Variables, then Redeploy)
- `GIFT_INGEST_SECRET` = your secret (must match the bridge's .env)
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (narrator), `ELEVENLABS_DRAGON_VOICE_ID` (dragon) — only for AI voice

---

## TikTok bridge (real gifts)
On your streaming PC, in the `tiktok-bridge` folder:
1. `.env` with:
   ```
   TIKTOK_USER=itsbenjamiiin
   HOARDBOUND_URL=https://hoard-bound.vercel.app
   GIFT_INGEST_SECRET=<same as Vercel>
   # optional if connect fails with a sign/rate-limit error:
   # SIGN_API_KEY=<free key from eulerstream.com>
   ```
2. `npm install`
3. Each stream: start a game (note the room code), go LIVE, then run:
   ```
   node -r dotenv/config bridge.js <ROOMCODE>
   ```
The bridge forwards ALL gifts: mapped gifts fire their power, everything else hits the generic fallback.
