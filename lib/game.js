// lib/game.js — pure Dragon's Hoard rules (no Supabase, no DOM).
// This is the single source of truth for mechanics. Matches the build bible §2.

export const ROUNDS = 12;
export const RAGE_MAX = 100;
export const WAKE_AT = 100;
export const START_HOARD = 50000;

export const PERSONAS = {
  greedy:   { tag: "Ravenous",     sneak: 0.15, grab: 0.60, low: 0.05, betray: 0.20 },
  cautious: { tag: "Careful",      sneak: 0.45, grab: 0.10, low: 0.40, betray: 0.05 },
  treach:   { tag: "Treacherous",  sneak: 0.20, grab: 0.25, low: 0.10, betray: 0.45 },
  loyal:    { tag: "Steadfast",    sneak: 0.50, grab: 0.25, low: 0.20, betray: 0.05 },
  wild:     { tag: "Unhinged",     sneak: 0.25, grab: 0.30, low: 0.20, betray: 0.25 },
};

export const TIERS = [
  { at: 0,  n: "Slumbering", c: "#f5c451" },
  { at: 25, n: "Stirring",   c: "#f0b23c" },
  { at: 50, n: "Watchful",   c: "#e5892e" },
  { at: 70, n: "Seething",   c: "#e5622e" },
  { at: 88, n: "Wrathful",   c: "#c8462a" },
];

export const BOT_NAMES = ["Coilspine","Ravenna","Ashfang","Mistral","Grimhild","Sable","Thorne","Wraithe","Vex","Ember"];
export const BOT_AVATARS = ["🦂","🦅","🐺","🦊","🐍","🦇","🕷️","🐗","🦉","🐀"];
export const PERSONA_KEYS = Object.keys(PERSONAS);

export const ACT_LABEL = { sneak: "🪙 Sneaking", grab: "💰 Grabbing", low: "🌑 Lying low", betray: "🗡️ Betraying", idle: "…" };

const RANGE = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const fmt = (n) => Math.round(n).toLocaleString();
export const pick = (arr) => arr[RANGE(0, arr.length - 1)];

export function rageTier(rage) {
  let t = TIERS[0];
  for (const r of TIERS) if (rage >= r.at) t = r;
  return t;
}

// Decide a bot's move given current room + all players.
export function decide(bot, room, players) {
  const p = { ...PERSONAS[bot.persona || "wild"] };
  if (room.rage >= 70) { p.grab *= 0.35; p.low += 0.35; p.betray *= 0.7; }
  else if (room.rage >= 50) { p.grab *= 0.7; p.low += 0.15; }
  if (bot.gold < 800) { p.grab += 0.15; p.low *= 0.5; }
  const roll = Math.random() * (p.sneak + p.grab + p.low + p.betray);
  let acc = 0;
  if (roll < (acc += p.sneak)) return { action: "sneak" };
  if (roll < (acc += p.grab))  return { action: "grab" };
  if (roll < (acc += p.low))   return { action: "low" };
  const target = players
    .filter((x) => x.id !== bot.id)
    .sort((a, b) => b.gold - a.gold)[0];
  return target && target.gold > 500 ? { action: "betray", target_id: target.id } : { action: "sneak" };
}

// Resolve one round. Pure: returns new player states, new room numbers, and events.
// Each player must carry `.choice = { action, target_id }`.
export function computeResolution(room, playersIn) {
  let rage = room.rage;
  let hoard = room.hoard;
  const events = [];

  // working copy
  const P = playersIn.map((p) => ({
    id: p.id, name: p.name, avatar: p.avatar, is_bot: p.is_bot,
    gold: p.gold, trust: p.trust, pact_with: p.pact_with,
    warded: false, last_take: 0, scorched: false,
    choice: p.choice || { action: "idle" },
  }));
  const map = Object.fromEntries(P.map((p) => [p.id, p]));

  // 1. wards
  P.forEach((p) => { if (p.choice.action === "low") p.warded = true; });

  // 2. takes
  const mult = room.double_next ? 2 : 1;
  P.forEach((p) => {
    if (p.choice.action === "sneak") {
      const amt = Math.min(hoard, RANGE(300, 700) * mult);
      p.gold += amt; hoard -= amt; p.last_take = amt; rage += 4;
    } else if (p.choice.action === "grab") {
      const amt = Math.min(hoard, RANGE(1200, 2200) * mult);
      p.gold += amt; hoard -= amt; p.last_take = amt; rage += 18;
    } else if (p.choice.action === "low") {
      const amt = Math.min(hoard, 200);
      p.gold += amt; hoard -= amt; p.trust = Math.min(100, p.trust + 2); rage = Math.max(0, rage - 8);
    }
  });

  const bigGrab = P.filter((p) => p.choice.action === "grab").sort((a, b) => b.last_take - a.last_take)[0];
  if (bigGrab) events.push({ kind: "take", payload: { name: bigGrab.name, amount: bigGrab.last_take } });

  // 3. betrayals
  P.forEach((p) => {
    if (p.choice.action !== "betray") return;
    const t = map[p.choice.target_id];
    if (!t) return;
    const isPact = p.pact_with === t.id;
    if (t.warded) {
      p.trust = Math.max(0, p.trust - 25); rage += 10;
      events.push({ kind: "betray_fail", payload: { from: p.name, to: t.name } });
    } else {
      const rate = isPact ? 0.6 : 0.4;
      const loot = Math.round(t.gold * rate);
      t.gold -= loot; p.gold += loot; p.last_take += loot; rage += 6;
      p.trust = Math.max(0, p.trust - (isPact ? 30 : 15));
      if (isPact) {
        p.pact_with = null; t.pact_with = null;
        events.push({ kind: "oath", payload: { from: p.name, to: t.name, amount: loot } });
      } else {
        events.push({ kind: "betray", payload: { from: p.name, to: t.name, amount: loot } });
      }
    }
  });

  // 4. pact bonus (both allied, neither betrayed the other)
  P.forEach((p) => {
    if (!p.pact_with) return;
    const ally = map[p.pact_with];
    if (!ally || ally.pact_with !== p.id) return;
    const brokeEachOther =
      (p.choice.action === "betray" && p.choice.target_id === ally.id) ||
      (ally.choice.action === "betray" && ally.choice.target_id === p.id);
    if (!brokeEachOther && p.last_take > 0) {
      const bonus = Math.round(p.last_take * 0.1);
      if (bonus > 0) {
        p.gold += bonus; p.trust = Math.min(100, p.trust + 5);
        events.push({ kind: "pact", payload: { name: p.name, amount: bonus } });
      }
    }
  });

  // 5. dragon
  let awakened = false;
  if (rage >= WAKE_AT) {
    awakened = true;
    const exposed = P.filter((p) => !p.warded && p.last_take > 0).sort((a, b) => b.last_take - a.last_take);
    const top = exposed.length ? exposed[0].last_take : 0;
    const victims = exposed.filter((p) => p.last_take >= top * 0.85).slice(0, 2);
    if (victims.length) {
      victims.forEach((p) => {
        const burn = Math.round(p.gold * 0.6);
        p.gold -= burn; p.scorched = true;
        events.push({ kind: "scorch", payload: { name: p.name, amount: burn } });
      });
      events.push({ kind: "awaken", payload: { victims: victims.map((v) => v.name) } });
    } else {
      events.push({ kind: "awaken", payload: { victims: [] } });
    }
    rage = 32;
  }

  hoard = Math.max(0, hoard);
  rage = Math.max(0, Math.round(rage));

  const players = P.map((p) => ({
    id: p.id, gold: Math.round(p.gold), trust: Math.round(p.trust),
    pact_with: p.pact_with, warded: p.warded, last_take: Math.round(p.last_take), scorched: p.scorched,
  }));

  return { players, room: { rage, hoard }, events, awakened };
}

// Director / gift effects. Returns { players:[{id,...}], room:{}, event:{} }.
export function directorEffect(kind, room, playersIn) {
  const P = playersIn.map((p) => ({ ...p }));
  let hoard = room.hoard, rage = room.rage, double_next = room.double_next;
  let event = null;

  if (kind === "meteor") {
    P.forEach((p) => { if (!p.warded) p.gold = Math.max(0, Math.round(p.gold * 0.85)); });
    event = { kind: "director", payload: { label: "☄️ Meteor Shower", text: "Everyone exposed lost 15% of their gold." } };
  } else if (kind === "double") {
    double_next = true;
    event = { kind: "director", payload: { label: "✨ Double Rewards", text: "Next round pays double." } };
  } else if (kind === "wake") {
    rage = WAKE_AT;
    event = { kind: "director", payload: { label: "🐉 Wake the Dragon", text: "The dragon will strike the greediest next round." } };
  } else if (kind === "reverse") {
    const sorted = P.slice().sort((a, b) => a.gold - b.gold);
    const golds = sorted.map((p) => p.gold).reverse();
    sorted.forEach((p, i) => { p.gold = golds[i]; });
    event = { kind: "director", payload: { label: "🔄 Reverse Standings", text: "Last is now first." } };
  } else if (kind === "curse") {
    const rich = P.slice().sort((a, b) => b.gold - a.gold)[0];
    if (rich) { const d = Math.round(rich.gold * 0.3); rich.gold -= d;
      event = { kind: "director", payload: { label: "💀 Curse the Richest", text: `${rich.name} loses ${fmt(d)} ◈.` } }; }
  } else if (kind === "bless") {
    const poor = P.slice().sort((a, b) => a.gold - b.gold)[0];
    if (poor) { const g = Math.min(hoard, 2000); poor.gold += g; hoard -= g;
      event = { kind: "director", payload: { label: "🕊️ Bless the Poorest", text: `${poor.name} gains ${fmt(g)} ◈.` } }; }
  } else if (kind === "gift_roses") {
    const poor = P.slice().sort((a, b) => a.gold - b.gold)[0];
    if (poor) { const g = Math.min(hoard, 1800); poor.gold += g; hoard -= g;
      event = { kind: "gift", payload: { label: "🌹 Roses", text: `A viewer blessed ${poor.name} with ${fmt(g)} ◈.`, name: poor.name } }; }
  } else if (kind === "gift_storm") {
    P.forEach((p) => { if (!p.warded) p.gold = Math.max(0, Math.round(p.gold * 0.88)); });
    event = { kind: "gift", payload: { label: "☄️ Storm", text: "A viewer struck the greedy — 12% of exposed gold lost." } };
  }

  return {
    players: P.map((p) => ({ id: p.id, gold: Math.round(p.gold) })),
    room: { rage: Math.round(rage), hoard: Math.round(hoard), double_next },
    event,
  };
}

// Human-readable chronicle line from an event row.
export function eventText(e) {
  const p = e.payload || {};
  switch (e.kind) {
    case "take": return `💰 <b>${p.name}</b> seized <b>${fmt(p.amount)} ◈</b> from the hoard.`;
    case "betray": return `🗡️ <b>${p.from}</b> robbed <b>${p.to}</b> of <b>${fmt(p.amount)} ◈</b>.`;
    case "betray_fail": return `🌑 <b>${p.from}</b> lunged at <b>${p.to}</b> — but they had vanished.`;
    case "oath": return `⚔️ <b>${p.from}</b> broke the pact and gutted <b>${p.to}</b> for <b>${fmt(p.amount)} ◈</b>.`;
    case "pact": return `🤝 Pact held: <b>${p.name}</b> earned a <b>${fmt(p.amount)} ◈</b> bonus.`;
    case "scorch": return `🔥 The dragon scorched <b>${p.name}</b> — <b>${fmt(p.amount)} ◈</b> turned to ash.`;
    case "awaken": return p.victims && p.victims.length
      ? `🔥 THE DRAGON AWAKENS — ${p.victims.join(" & ")} burned for their greed.`
      : `🔥 The dragon stirred, but the wary slipped into shadow.`;
    case "director": return `🎬 <b>${p.label}</b> — ${p.text}`;
    case "gift": return `🎁 <b>${p.label}</b> — ${p.text}`;
    default: return "";
  }
}
