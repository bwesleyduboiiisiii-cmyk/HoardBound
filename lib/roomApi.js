// lib/roomApi.js — everything that touches Supabase lives here.
import { supabase } from "./supabaseClient";
import {
  START_HOARD, ROUNDS, BOT_NAMES, BOT_AVATARS, PERSONA_KEYS,
  decide, computeResolution, directorEffect, giftEffect, pick,
} from "./game";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no confusables
const genCode = () =>
  Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");

export const uuid = () =>
  (crypto?.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2));

// Deterministic UUID from a string, so one account always maps to the same host id
// (and therefore the same, reusable room code) on any device.
export function stableHostId(str) {
  const s = String(str || "anon");
  const seg = (salt) => {
    let x = (0x811c9dc5 ^ salt) >>> 0;
    for (let i = 0; i < s.length; i++) { x = (x ^ s.charCodeAt(i)) >>> 0; x = Math.imul(x, 16777619) >>> 0; }
    return ("00000000" + x.toString(16)).slice(-8);
  };
  const h = seg(1) + seg(2) + seg(3) + seg(4);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---- Accounts (username + 5-digit code + profile picture) ----
export async function signInAccount(username, code, avatarUrl, loginOnly = false) {
  const uname = (username || "").trim().slice(0, 18);
  const pin = (code || "").trim();
  if (!uname) throw new Error("Pick a username.");
  if (!/^\d{5}$/.test(pin)) throw new Error("Your code must be 5 digits.");
  const { data: existing } = await supabase.from("accounts").select("*").eq("username", uname).maybeSingle();
  if (existing) {
    if (existing.code !== pin) throw new Error("Wrong code for that username.");
    if (avatarUrl && avatarUrl !== existing.avatar_url) {
      try { await supabase.from("accounts").update({ avatar_url: avatarUrl }).eq("username", uname); } catch (e) {}
      return { username: uname, code: pin, avatarUrl };
    }
    return { username: uname, code: pin, avatarUrl: existing.avatar_url || null };
  }
  if (loginOnly) throw new Error("No account with that username — create one instead.");
  const row = { username: uname, code: pin };
  if (avatarUrl) row.avatar_url = avatarUrl;
  const { error } = await supabase.from("accounts").insert(row);
  if (error) throw new Error("Could not create the account. Try a different username.");
  return { username: uname, code: pin, avatarUrl: avatarUrl || null };
}

// Update a signed-in account's profile picture.
export async function updateAccountAvatar(username, avatarUrl) {
  try { await supabase.from("accounts").update({ avatar_url: avatarUrl }).eq("username", (username || "").trim().slice(0, 18)); } catch (e) {}
}

// Look up profile pictures by username, straight from the accounts table.
// This makes avatars show even if the players table never got an avatar_url column.
export async function getAvatarsByNames(names) {
  const out = {};
  const list = (names || []).filter(Boolean);
  if (!list.length) return out;
  try {
    const { data } = await supabase.from("accounts").select("username, avatar_url").in("username", list);
    (data || []).forEach((a) => { if (a.avatar_url) out[a.username] = a.avatar_url; });
  } catch (e) {}
  return out;
}

// ---- Room lifecycle ----
export async function createRoom(hostId) {
  for (let i = 0; i < 6; i++) {
    const code = genCode();
    const { data, error } = await supabase
      .from("rooms")
      .insert({ code, host_id: hostId, status: "lobby", round: 0, rage: 0, hoard: START_HOARD, double_next: false })
      .select()
      .single();
    if (!error) return data;
    if (error.code !== "23505") throw error; // retry only on unique-code collision
  }
  throw new Error("Could not generate a unique room code.");
}

// Reuse the host's existing room (same code, reset to a fresh lobby) or make one.
export async function getOrCreateRoom(hostId) {
  const { data } = await supabase.from("rooms").select("*").eq("host_id", hostId).limit(1);
  if (data && data.length) {
    const room = data[0];
    await resetGame(room.id); // fresh lobby, same code
    const fresh = await getRoomByCode(room.code);
    return fresh || room;
  }
  return createRoom(hostId);
}

export async function getRoomByCode(code) {
  const { data, error } = await supabase.from("rooms").select("*").eq("code", code.toUpperCase()).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getPlayers(roomId) {
  const { data, error } = await supabase.from("players").select("*").eq("room_id", roomId);
  if (error) throw error;
  return data || [];
}

export async function addBot(roomId, existing = [], name = "") {
  const used = new Set(existing.map((p) => p.name));
  let botName = (name || "").trim().slice(0, 18);
  if (botName) {
    // keep names unique so the leaderboard stays readable
    let base = botName, n = 2;
    while (used.has(botName) && n < 50) botName = `${base} ${n++}`;
  } else {
    botName = pick(BOT_NAMES); let guard = 0;
    while (used.has(botName) && guard++ < 20) botName = pick(BOT_NAMES);
  }
  const { data, error } = await supabase
    .from("players")
    .insert({ room_id: roomId, name: botName, avatar: pick(BOT_AVATARS), is_bot: true, persona: pick(PERSONA_KEYS), gold: 0, trust: 50 })
    .select().single();
  if (error) throw error;
  return data;
}

export async function renamePlayer(playerId, name) {
  const clean = (name || "").trim().slice(0, 18);
  if (!clean) return;
  const { error } = await supabase.from("players").update({ name: clean }).eq("id", playerId);
  if (error) throw error;
}

export async function joinRoom(code, name, avatarUrl = null) {
  const room = await getRoomByCode(code);
  if (!room) throw new Error("No game found with that code.");
  const avatar = pick(["🥷","🎭","👑","🗡️","🏹","🛡️","💠","🔮"]);
  const row = { room_id: room.id, name: name.slice(0, 18), avatar, is_bot: false, gold: 0, trust: 50 };
  if (avatarUrl) row.avatar_url = avatarUrl;
  let { data, error } = await supabase.from("players").insert(row).select().single();
  // if the avatar_url column isn't migrated yet, retry without it so joining never fails
  if (error && avatarUrl) {
    delete row.avatar_url;
    ({ data, error } = await supabase.from("players").insert(row).select().single());
  }
  if (error) throw error;
  return { room, player: data };
}

// Start (or advance to) a round: reset per-round flags and open submissions.
export async function startRound(roomId, round) {
  await supabase.from("players").update({ warded: false, last_take: 0 }).eq("room_id", roomId);
  // choose one random hunter who may buy the special spell move this round
  let spellPlayer = null;
  try { const ps = await getPlayers(roomId); if (ps.length) spellPlayer = pick(ps).id; } catch (e) {}
  const { error } = await supabase.from("rooms").update({ status: "active", round }).eq("id", roomId);
  if (error) throw error;
  if (spellPlayer) { try { await supabase.from("rooms").update({ spell_player: spellPlayer }).eq("id", roomId); } catch (e) {} }
}

// Host sets the starting hoard before a match begins.
export async function setHoard(roomId, amount) {
  const n = Math.max(0, Math.round(Number(amount) || 0));
  const { error } = await supabase.from("rooms").update({ hoard: n }).eq("id", roomId);
  if (error) throw error;
  return n;
}

// Host grants (or removes, if negative) gold to a single player.
export async function grantGold(playerId, delta) {
  const { data: p } = await supabase.from("players").select("gold").eq("id", playerId).maybeSingle();
  const cur = (p && p.gold) || 0;
  const next = Math.max(0, cur + Math.round(Number(delta) || 0));
  const { error } = await supabase.from("players").update({ gold: next }).eq("id", playerId);
  if (error) throw error;
  return next;
}

// Which players have already submitted a move this round (so the host can see who's still choosing).
export async function getMovedPlayerIds(roomId, round) {
  const { data } = await supabase.from("moves").select("player_id").eq("room_id", roomId).eq("round", round);
  return (data || []).map((m) => m.player_id);
}

export async function submitMove(roomId, playerId, round, action, targetId = null) {
  const { error } = await supabase
    .from("moves")
    .upsert(
      { room_id: roomId, player_id: playerId, round, action, target_id: targetId },
      { onConflict: "room_id,player_id,round" }
    );
  if (error) throw error;
}

// Pact offers made TO me this round (so I can accept/deny). Only reveals pact offers, not other moves.
export async function getPactOffers(roomId, round, myId) {
  const { data } = await supabase.from("moves").select("player_id")
    .eq("room_id", roomId).eq("round", round).eq("action", "pact").eq("target_id", myId);
  return (data || []).map((m) => m.player_id);
}

export async function getMoveCount(roomId, round) {
  const { count, error } = await supabase
    .from("moves").select("*", { count: "exact", head: true })
    .eq("room_id", roomId).eq("round", round);
  if (error) throw error;
  return count || 0;
}

// HOST-AUTHORITATIVE resolution (bible §5.4). Reads state, computes, writes.
export async function resolveRound(room) {
  // Idempotency claim: flip active→resolving atomically so a round can only resolve once
  // (guards against autoplay racing a manual tap, or a realtime echo double-firing).
  const claim = await supabase.from("rooms").update({ status: "resolving" })
    .eq("id", room.id).eq("status", "active").select("id");
  if (!claim.data || claim.data.length === 0) {
    return { skipped: true, players: [], room: {}, events: [], ended: false };
  }

  const players = await getPlayers(room.id);
  const { data: moves } = await supabase
    .from("moves").select("*").eq("room_id", room.id).eq("round", room.round);
  const moveByPlayer = Object.fromEntries((moves || []).map((m) => [m.player_id, m]));

  // attach choices: humans from moves (idle if none), bots decided live
  const withChoice = players.map((p) => {
    if (p.is_bot) return { ...p, choice: decide(p, room, players) };
    const m = moveByPlayer[p.id];
    return { ...p, choice: m ? { action: m.action, target_id: m.target_id } : { action: "idle" } };
  });

  const res = computeResolution(room, withChoice);

  // persist player states
  await Promise.all(
    res.players.map((p) =>
      supabase.from("players").update({
        gold: p.gold, trust: p.trust, pact_with: p.pact_with,
        warded: p.warded, last_take: p.last_take,
      }).eq("id", p.id)
    )
  );

  const ended = room.round >= ROUNDS || res.room.hoard <= 0;
  await supabase.from("rooms").update({
    rage: res.room.rage, hoard: res.room.hoard,
    status: ended ? "ended" : "resolving", double_next: false,
  }).eq("id", room.id);
  // carry-over gift modifiers (e.g. an unused double-sneak); jsonb column may not be migrated yet
  try { await supabase.from("rooms").update({ modifiers: res.room.modifiers || {} }).eq("id", room.id); } catch (e) {}

  if (res.events.length) {
    const base = Date.now();
    await supabase.from("events").insert(
      res.events.map((e, i) => ({
        room_id: room.id, round: room.round, kind: e.kind, payload: e.payload,
        created_at: new Date(base + i).toISOString(),
      }))
    );
  }
  if (ended) {
    const results = players.filter((p) => !p.is_bot).map((p) => ({
      name: p.name, gold: (res.players.find((x) => x.id === p.id) || {}).gold || 0,
    }));
    await recordResults(results);
  }
  return { ...res, ended };
}

export async function fireDirector(room, kind) {
  const players = await getPlayers(room.id);
  const eff = directorEffect(kind, room, players);
  await Promise.all(
    eff.players
      .filter((p) => players.find((x) => x.id === p.id && x.gold !== p.gold))
      .map((p) => supabase.from("players").update({ gold: p.gold }).eq("id", p.id))
  );
  await supabase.from("rooms").update({
    rage: eff.room.rage, hoard: eff.room.hoard, double_next: eff.room.double_next,
  }).eq("id", room.id);
  if (eff.event) {
    await supabase.from("events").insert({ room_id: room.id, round: room.round, kind: eff.event.kind, payload: eff.event.payload });
  }
}

export async function fireGift(room, giftType, opts = {}) {
  const players = await getPlayers(room.id);
  const eff = giftEffect(giftType, room, players, opts);
  await Promise.all(
    eff.players
      .filter((np) => {
        const old = players.find((x) => x.id === np.id);
        return old && (old.gold !== np.gold || old.trust !== np.trust || old.warded !== np.warded || old.pact_with !== np.pact_with);
      })
      .map((np) => supabase.from("players").update({ gold: np.gold, trust: np.trust, warded: np.warded, pact_with: np.pact_with }).eq("id", np.id))
  );
  await supabase.from("rooms").update({
    rage: eff.room.rage, hoard: eff.room.hoard, double_next: eff.room.double_next,
  }).eq("id", room.id);
  // round modifiers live in a jsonb column that may not be migrated yet — never let it break gifts
  try { await supabase.from("rooms").update({ modifiers: eff.room.modifiers }).eq("id", room.id); } catch (e) {}
  if (eff.events.length) {
    const base = Date.now();
    await supabase.from("events").insert(eff.events.map((e, i) => ({
      room_id: room.id, round: room.round, kind: e.kind, payload: e.payload,
      created_at: new Date(base + i).toISOString(),
    })));
  }
  return eff.alert;
}

export async function endGame(roomId) {
  const players = await getPlayers(roomId);
  const { error } = await supabase.from("rooms").update({ status: "ended" }).eq("id", roomId);
  if (error) throw error;
  await recordResults(players.filter((p) => !p.is_bot).map((p) => ({ name: p.name, gold: p.gold })));
}

export async function resetGame(roomId) {
  await supabase.from("moves").delete().eq("room_id", roomId);
  await supabase.from("events").delete().eq("room_id", roomId);
  await supabase.from("players").update({ gold: 0, trust: 50, pact_with: null, warded: false, last_take: 0 }).eq("room_id", roomId);
  await supabase.from("rooms").update({ status: "lobby", round: 0, rage: 0, hoard: START_HOARD, double_next: false }).eq("id", roomId);
  try { await supabase.from("rooms").update({ modifiers: {} }).eq("id", roomId); } catch (e) {}
}

export async function setConnected(playerId, connected) {
  try { await supabase.from("players").update({ connected }).eq("id", playerId); } catch (e) {}
}

// ---- Persistent season leaderboard (keyed by hunter name) ----
export async function recordResults(results) {
  if (!results || !results.length) return;
  const winner = results.slice().sort((a, b) => b.gold - a.gold)[0];
  const names = results.map((r) => r.name);
  let existing = [];
  try {
    const { data, error } = await supabase.from("leaders").select("*").in("name", names);
    if (error) console.warn("[leaders] read failed:", error.message);
    existing = data || [];
  } catch (e) { console.warn("[leaders] read threw:", e); }
  const byName = Object.fromEntries(existing.map((r) => [r.name, r]));
  const rows = results.map((r) => {
    const e = byName[r.name] || { games: 0, wins: 0, total_gold: 0, best_gold: 0 };
    return {
      name: r.name,
      games: (e.games || 0) + 1,
      wins: (e.wins || 0) + (winner && r.name === winner.name ? 1 : 0),
      total_gold: Number(e.total_gold || 0) + Number(r.gold || 0),
      best_gold: Math.max(Number(e.best_gold || 0), Number(r.gold || 0)),
      updated_at: new Date().toISOString(),
    };
  });
  try {
    const { error } = await supabase.from("leaders").upsert(rows, { onConflict: "name" });
    if (error) console.warn("[leaders] write failed — is the `leaders` table migrated? ", error.message);
  } catch (e) { console.warn("[leaders] write threw — run supabase/schema.sql (leaders table): ", e); }
}

export async function getLeaders(limit = 50) {
  const { data, error } = await supabase.from("leaders").select("*")
    .order("total_gold", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message || "Could not read the leaderboard.");
  return data || [];
}

// Fire a gift by ROOM CODE (used by the TikTok ingestion endpoint).
export async function fireGiftByCode(code, giftType, opts = {}) {
  const room = await getRoomByCode(code);
  if (!room) throw new Error("room not found");
  if (room.status !== "active" && room.status !== "resolving") return { skipped: "not in play" };
  // Power-up window gate: viewer gifts only fire an effect while the window is open.
  const until = room.gift_window_until ? new Date(room.gift_window_until).getTime() : 0;
  if (!until || until < Date.now()) return { skipped: "window closed" };
  return fireGift(room, giftType, opts);
}

// Host opens a timed window during which viewer power-ups count. Closing = set null / past.
export async function openGiftWindow(roomId, seconds) {
  const until = new Date(Date.now() + Math.max(1, Number(seconds) || 20) * 1000).toISOString();
  const { error } = await supabase.from("rooms").update({ gift_window_until: until }).eq("id", roomId);
  if (error) throw error;
  return until;
}
export async function closeGiftWindow(roomId) {
  try { await supabase.from("rooms").update({ gift_window_until: null }).eq("id", roomId); } catch (e) {}
}

export async function removePlayer(playerId) {
  await supabase.from("moves").delete().eq("player_id", playerId);
  const { error } = await supabase.from("players").delete().eq("id", playerId);
  if (error) throw error;
}

// ---- Realtime helpers ----
// Subscribe to all changes for a room's rows. cb() fires on any change.
export function subscribeRoom(roomId, cb) {
  const ch = supabase
    .channel("room:" + roomId)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, cb)
    .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` }, cb)
    .on("postgres_changes", { event: "*", schema: "public", table: "events", filter: `room_id=eq.${roomId}` }, cb)
    .on("postgres_changes", { event: "*", schema: "public", table: "moves", filter: `room_id=eq.${roomId}` }, cb)
    .subscribe();
  return () => supabase.removeChannel(ch);
}

export async function getEvents(roomId, limit = 12) {
  const { data } = await supabase
    .from("events").select("*").eq("room_id", roomId)
    .order("created_at", { ascending: false }).limit(limit);
  return data || [];
}
