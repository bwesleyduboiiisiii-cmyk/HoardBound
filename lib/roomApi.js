// lib/roomApi.js — everything that touches Supabase lives here.
import { supabase } from "./supabaseClient";
import {
  START_HOARD, ROUNDS, BOT_NAMES, BOT_AVATARS, PERSONA_KEYS,
  decide, computeResolution, directorEffect, pick,
} from "./game";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no confusables
const genCode = () =>
  Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");

export const uuid = () =>
  (crypto?.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2));

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

export async function addBot(roomId, existing = []) {
  const used = new Set(existing.map((p) => p.name));
  let name = pick(BOT_NAMES), avatar = pick(BOT_AVATARS), guard = 0;
  while (used.has(name) && guard++ < 20) name = pick(BOT_NAMES);
  const { data, error } = await supabase
    .from("players")
    .insert({ room_id: roomId, name, avatar, is_bot: true, persona: pick(PERSONA_KEYS), gold: 0, trust: 50 })
    .select().single();
  if (error) throw error;
  return data;
}

export async function joinRoom(code, name) {
  const room = await getRoomByCode(code);
  if (!room) throw new Error("No game found with that code.");
  const avatar = pick(["🥷","🎭","👑","🗡️","🏹","🛡️","💠","🔮"]);
  const { data, error } = await supabase
    .from("players")
    .insert({ room_id: room.id, name: name.slice(0, 18), avatar, is_bot: false, gold: 0, trust: 50 })
    .select().single();
  if (error) throw error;
  return { room, player: data };
}

// Start (or advance to) a round: reset per-round flags and open submissions.
export async function startRound(roomId, round) {
  await supabase.from("players").update({ warded: false, last_take: 0 }).eq("room_id", roomId);
  const { error } = await supabase.from("rooms").update({ status: "active", round }).eq("id", roomId);
  if (error) throw error;
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

export async function getMoveCount(roomId, round) {
  const { count, error } = await supabase
    .from("moves").select("*", { count: "exact", head: true })
    .eq("room_id", roomId).eq("round", round);
  if (error) throw error;
  return count || 0;
}

// HOST-AUTHORITATIVE resolution (bible §5.4). Reads state, computes, writes.
export async function resolveRound(room) {
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

  // double_next multiplier is honored inside computeResolution
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

  if (res.events.length) {
    await supabase.from("events").insert(
      res.events.map((e) => ({ room_id: room.id, round: room.round, kind: e.kind, payload: e.payload }))
    );
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

export async function resetGame(roomId) {
  await supabase.from("moves").delete().eq("room_id", roomId);
  await supabase.from("events").delete().eq("room_id", roomId);
  await supabase.from("players").update({ gold: 0, trust: 50, pact_with: null, warded: false, last_take: 0 }).eq("room_id", roomId);
  await supabase.from("rooms").update({ status: "lobby", round: 0, rage: 0, hoard: START_HOARD, double_next: false }).eq("id", roomId);
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
