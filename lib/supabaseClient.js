// lib/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

// Placeholders keep next build from throwing when env isn't set yet.
// Real values come from .env.local / Vercel env at runtime.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createClient(url, key, {
  realtime: { params: { eventsPerSecond: 10 } },
});

export const hasSupabase = () =>
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
