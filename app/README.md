# Hoardbound — Dragon's Hoard (Phase 2: Realtime Multiplayer)

Three surfaces sharing one live game state over Supabase Realtime:

- **`/host`** — you, the gamemaster. Create a room, add bots, run rounds, fire Director powers.
- **`/play/[code]`** — players join from their phones and pick a move each round.
- **`/live/[code]`** — read-only cinematic overlay for OBS. Add `?bg=transparent` to composite over your camera.

Rules live in `lib/game.js` (pure functions — the single source of truth, matching the build bible §2). All Supabase reads/writes live in `lib/roomApi.js`.

## Setup (about 5 minutes)

1. **Create a Supabase project** at supabase.com (free tier is fine).
2. **Run the schema.** Open Supabase → SQL Editor, paste all of `supabase/schema.sql`, Run.
3. **Get your keys.** Supabase → Settings → API → copy the Project URL and the `anon` public key.
4. **Configure env.** Copy `.env.local.example` to `.env.local` and fill both values.
5. **Install & run:**
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:3000.

## Try it locally

- Open `/host` → Create a Game → Add a couple of bots → open `/play/CODE` in another tab (or your phone) and join → back on host, Begin the Plunder → Resolve Round.
- Open `/live/CODE` in a third tab to watch the cinematic view react in real time.

## Deploy (GitHub → Vercel)

1. Push this repo to GitHub.
2. Import it in Vercel.
3. Add the two env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) in Vercel → Project → Settings → Environment Variables.
4. Deploy. Point OBS at `https://your-app.vercel.app/live/CODE`.

## How a round works

Host-authoritative (build bible §5.4): the host client reads room state, generates bot moves, applies the exact resolution from `lib/game.js`, and writes the results + chronicle events back to Supabase. Every surface subscribes to those changes and re-renders. Humans who don't submit in time simply sit the round out — bots and other players never stall.

## Known TODOs (next passes)

- **Live pacts.** Resolution already honors `pact_with`; forming/accepting pacts from the player controller isn't wired yet. Add a pact request/accept event flow.
- **Move resolution to an Edge Function** so the host client can't tamper with math (harden RLS at the same time — current policies in `schema.sql` are permissive dev policies).
- **Round timer** on host + players (auto-resolve on expiry).
- **Real TikTok gift ingestion** to drive the gift powers instead of the host's simulate buttons.
- **Reconnect polish** and disconnect detection (`players.connected`).
