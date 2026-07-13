# HOARDBOUND — TikTok gift bridge

Forwards real TikTok LIVE gifts into a running Dragon's Hoard game.

## One-time setup

1. **Add a shared secret to your app** (Vercel → Project → Settings → Environment Variables):
   - `GIFT_INGEST_SECRET` = any long random string. Redeploy.
2. **On the computer that will run the bridge** (the same one you stream from is fine), install Node 18+.
3. In this `tiktok-bridge` folder, run `npm install`.
4. Create a file named `.env` here with:

   ```
   TIKTOK_USER=yourtiktokusername        # without the @
   HOARDBOUND_URL=https://your-app.vercel.app
   GIFT_INGEST_SECRET=the-same-secret-you-put-in-vercel
   # optional — only if connecting fails with a "sign"/"rate limit" error:
   # SIGN_API_KEY=your-free-key-from-eulerstream.com
   ```

## Each stream

1. Start your Dragon's Hoard game as host — note the **room code** (e.g. `FKKDH`).
2. Go LIVE on TikTok.
3. Start the bridge with that room code:

   ```
   node -r dotenv/config bridge.js FKKDH
   ```
   (or just `node bridge.js FKKDH` — this build loads `.env` automatically)

When a viewer sends **Rose / Finger Heart / Hi Bear / Doughnut**, the matching power-up fires in the
game automatically and the gifter's name shows on the overlay + Top Patrons. You can still trigger
gifts by hand from the host screen at any time.

Gift → effect: Rose = Dragon's Blessing, Finger Heart = Fortune's Favor, Hi Bear = Bear's Blessing, Doughnut = Chaos Doughnut.

## If connecting fails

TikTok requires requests to be "signed." This build uses the maintained signing service. If your
connection fails with a message about **sign / signature / rate limit**, get a **free** API key at
**https://www.eulerstream.com**, then add one line to your `.env`:

```
SIGN_API_KEY=your-free-key-here
```

and run the bridge again. The free tier is plenty for a single stream.

> Note: this bridge now uses tiktok-live-connector v2 (ES modules). Node 18+ required.
