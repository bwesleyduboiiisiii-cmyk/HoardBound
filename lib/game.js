// lib/game.js — pure Dragon's Hoard rules (no Supabase, no DOM).
// This is the single source of truth for mechanics. Matches the build bible §2.

export const ROUNDS = 12;
export const RAGE_MAX = 100;
export const WAKE_AT = 100;
export const START_HOARD = 50000;

export const PERSONAS = {
  greedy:   { tag: "Ravenous",     sneak: 0.15, grab: 0.55, low: 0.05, betray: 0.20, pact: 0.05 },
  cautious: { tag: "Careful",      sneak: 0.40, grab: 0.10, low: 0.35, betray: 0.05, pact: 0.10 },
  treach:   { tag: "Treacherous",  sneak: 0.20, grab: 0.20, low: 0.10, betray: 0.45, pact: 0.05 },
  loyal:    { tag: "Steadfast",    sneak: 0.45, grab: 0.20, low: 0.15, betray: 0.05, pact: 0.15 },
  wild:     { tag: "Unhinged",     sneak: 0.25, grab: 0.25, low: 0.20, betray: 0.20, pact: 0.10 },
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

export const ACT_LABEL = { sneak: "🪙 Sneaking", grab: "💰 Grabbing", low: "🌑 Lying low", betray: "🗡️ Betraying", pact: "🤝 Forming a pact", idle: "…" };

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
  const roll = Math.random() * (p.sneak + p.grab + p.low + p.betray + p.pact);
  let acc = 0;
  if (roll < (acc += p.sneak)) return { action: "sneak" };
  if (roll < (acc += p.grab))  return { action: "grab" };
  if (roll < (acc += p.low))   return { action: "low" };
  if (roll < (acc += p.pact)) {
    // already allied → play safe and keep the oath; otherwise offer a pact to a like-sized rival
    if (bot.pact_with) return { action: "sneak" };
    const partner = players
      .filter((x) => x.id !== bot.id && !x.pact_with)
      .sort((a, b) => Math.abs(a.gold - bot.gold) - Math.abs(b.gold - bot.gold))[0]
      || players.find((x) => x.id !== bot.id);
    return partner ? { action: "pact", target_id: partner.id } : { action: "sneak" };
  }
  // betray the richest — but only a Treacherous bot will knife its own ally
  let pool = players.filter((x) => x.id !== bot.id);
  if (bot.persona !== "treach" && bot.pact_with) pool = pool.filter((x) => x.id !== bot.pact_with);
  const target = pool.sort((a, b) => b.gold - a.gold)[0];
  return target && target.gold > 500 ? { action: "betray", target_id: target.id } : { action: "sneak" };
}

// Resolve one round. Pure: returns new player states, new room numbers, and events.
// Each player must carry `.choice = { action, target_id }`.
export function computeResolution(room, playersIn) {
  let rage = room.rage;
  let hoard = room.hoard;
  const events = [];
  let seq = 0;
  const push = (kind, payload) => events.push({ kind, payload: { ...payload, seq: seq++ } });

  // working copy
  const P = playersIn.map((p) => ({
    id: p.id, name: p.name, avatar: p.avatar, is_bot: p.is_bot,
    gold: p.gold, trust: p.trust, pact_with: p.pact_with,
    warded: false, last_take: 0, scorched: false,
    choice: p.choice || { action: "idle" },
  }));
  const map = Object.fromEntries(P.map((p) => [p.id, p]));
  const M = room.modifiers || {};
  const addRage = (n) => { if (!M.rageFrozen) rage += n; };

  // 1. wards (Lie Low, or a gift-granted ward for this round)
  P.forEach((p) => { if (p.choice.action === "low" || (M.wardIds || []).includes(p.id)) p.warded = true; });

  // 2. takes — log EVERY move so the chronicle is complete
  const mult = room.double_next ? 2 : 1;
  const grabMult = M.grabMult || 1;
  P.forEach((p) => {
    if (p.choice.action === "sneak") {
      const sneakX = (M.doubleSneak && M.doubleSneak[p.id]) ? 2 : 1;
      const amt = Math.min(hoard, RANGE(300, 700) * mult * sneakX);
      p.gold += amt; hoard -= amt; p.last_take = amt; addRage(4);
      push("move", { name: p.name, action: "sneak", amount: amt });
    } else if (p.choice.action === "grab") {
      const amt = Math.min(hoard, RANGE(1200, 2200) * mult * grabMult);
      p.gold += amt; hoard -= amt; p.last_take = amt; addRage(18);
      push("move", { name: p.name, action: "grab", amount: amt });
    } else if (p.choice.action === "low") {
      const amt = Math.min(hoard, 200);
      p.gold += amt; hoard -= amt; p.trust = Math.min(100, p.trust + 2); rage = Math.max(0, rage - 8);
      push("move", { name: p.name, action: "low" });
    } else if (p.choice.action === "pact") {
      const t = map[p.choice.target_id];
      const amt = Math.min(hoard, 300);
      p.gold += amt; hoard -= amt; p.last_take = amt;
      p.trust = Math.min(100, p.trust + 2); addRage(2);
      push("pact_offer", { name: p.name, to: t ? t.name : "someone" });
    } else if (p.choice.action === "idle") {
      push("move", { name: p.name, action: "idle" });
    }
  });

  // 2.5 mutual pact formation — a pact only seals when BOTH offered it to each other this round
  P.forEach((p) => {
    if (p.choice.action !== "pact") return;
    const t = map[p.choice.target_id];
    if (t && t.choice.action === "pact" && t.choice.target_id === p.id) {
      p.pact_with = t.id;
      if (p.id < t.id) push("pact_sealed", { a: p.name, b: t.name });
    }
  });

  // 3. betrayals
  const betrayMult = M.betrayMult || 1;
  const buffet = !!M.guaranteedBetray; // "Backstab Buffet" — betrayals hit harder this round
  P.forEach((p) => {
    if (p.choice.action !== "betray") return;
    const t = map[p.choice.target_id];
    if (!t) return;
    const isPact = p.pact_with === t.id;
    if (t.warded) {
      p.trust = Math.max(0, p.trust - Math.round(25 * betrayMult)); addRage(10);
      push("betray_fail", { from: p.name, to: t.name });
    } else {
      const base = isPact ? 0.6 : 0.4;
      const rate = buffet ? Math.min(0.9, base + 0.2) : base;
      const loot = Math.round(t.gold * rate * betrayMult);
      t.gold -= loot; p.gold += loot; p.last_take += loot; addRage(6);
      p.trust = Math.max(0, p.trust - Math.round((isPact ? 30 : 15) * betrayMult));
      if (isPact) {
        p.pact_with = null; t.pact_with = null;
        push("oath", { from: p.name, to: t.name, amount: loot });
      } else {
        push("betray", { from: p.name, to: t.name, amount: loot });
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
        push("pact", { name: p.name, amount: bonus });
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
        push("scorch", { name: p.name, amount: burn });
      });
      push("awaken", { victims: victims.map((v) => v.name) });
    } else {
      push("awaken", { victims: [] });
    }
    rage = 32;
  }

  hoard = Math.max(0, hoard);
  rage = Math.max(0, Math.round(rage));

  // carry-over modifiers: a Silent Fortune double-sneak survives until used, or expires after 2 rounds
  const carryDouble = {};
  for (const [id, rounds] of Object.entries(M.doubleSneak || {})) {
    const pl = map[id];
    if (pl && pl.choice.action === "sneak") continue; // used this round → consumed
    const left = (Number(rounds) || 1) - 1;
    if (left > 0) carryDouble[id] = left;
  }
  const carryModifiers = Object.keys(carryDouble).length ? { doubleSneak: carryDouble } : {};

  const players = P.map((p) => ({
    id: p.id, gold: Math.round(p.gold), trust: Math.round(p.trust),
    pact_with: p.pact_with, warded: p.warded, last_take: Math.round(p.last_take), scorched: p.scorched,
  }));

  return { players, room: { rage, hoard, modifiers: carryModifiers }, events, awakened };
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
  }

  return {
    players: P.map((p) => ({ id: p.id, gold: Math.round(p.gold) })),
    room: { rage: Math.round(rage), hoard: Math.round(hoard), double_next },
    event,
  };
}

// Human-readable chronicle line from an event row.
export function feedClass(kind) {
  if (["scorch", "awaken", "oath", "betray_fail"].includes(kind)) return "fire";
  if (kind === "pact" || kind === "pact_offer" || kind === "pact_sealed") return "pact";
  if (kind === "gift") return "gift";
  if (kind === "take") return "gold";
  return "";
}

export function eventText(e) {
  const p = e.payload || {};
  switch (e.kind) {
    case "take": return `💰 <b>${p.name}</b> seized <b>${fmt(p.amount)} ◈</b> from the hoard.`;
    case "move":
      if (p.action === "grab") return `💰 <b>${p.name}</b> grabbed <b>${fmt(p.amount)} ◈</b>.`;
      if (p.action === "sneak") return `🪙 <b>${p.name}</b> sneaked <b>${fmt(p.amount)} ◈</b>.`;
      if (p.action === "low") return `🌑 <b>${p.name}</b> lay low — warded.`;
      return `💤 <b>${p.name}</b> sat out.`;
    case "betray": return `🗡️ <b>${p.from}</b> robbed <b>${p.to}</b> of <b>${fmt(p.amount)} ◈</b>.`;
    case "betray_fail": return `🌑 <b>${p.from}</b> lunged at <b>${p.to}</b> — but they had vanished.`;
    case "oath": return `⚔️ <b>${p.from}</b> broke the pact and gutted <b>${p.to}</b> for <b>${fmt(p.amount)} ◈</b>.`;
    case "pact": return `🤝 Pact held: <b>${p.name}</b> earned a <b>${fmt(p.amount)} ◈</b> bonus.`;
    case "pact_offer": return `🤝 <b>${p.name}</b> offered a pact to <b>${p.to}</b>.`;
    case "pact_sealed": return `🤝 <b>${p.a}</b> and <b>${p.b}</b> sealed a pact.`;
    case "scorch": return `🔥 The dragon scorched <b>${p.name}</b> — <b>${fmt(p.amount)} ◈</b> turned to ash.`;
    case "awaken": return p.victims && p.victims.length
      ? `🔥 THE DRAGON AWAKENS — ${p.victims.join(" & ")} burned for their greed.`
      : `🔥 The dragon stirred, but the wary slipped into shadow.`;
    case "director": return `🎬 <b>${p.label}</b> — ${p.text}`;
    case "gift": return `🎁 <b>${p.label}</b> — ${p.text}`;
    default: return "";
  }
}

// Which dragon artwork to show for a given rage level.
export function rageStage(rage) {
  return rage >= 85 ? "attack" : rage >= 45 ? "awake" : "sleep";
}

/* ============================ GIFT POWER-UPS ============================ */
export const GIFT_VALUES = { rose: 1, finger_heart: 5, hi_bear: 10, doughnut: 30 };
export const GIFT_META = {
  rose:         { emoji: "🌹", power: "Dragon's Blessing", coins: 1,  blurb: "A random hunter receives 1,800 gold." },
  finger_heart: { emoji: "🫰", power: "Fortune's Favor",   coins: 5,  blurb: "Triggers a random helpful bonus." },
  hi_bear:      { emoji: "🧸", power: "Bear's Blessing",    coins: 10, blurb: "Helps or protects the whole lobby." },
  doughnut:     { emoji: "🍩", power: "Chaos Doughnut",     coins: 30, blurb: "Spins the Chaos Wheel — anything can happen." },
};
export const GIFT_ORDER = ["rose", "finger_heart", "hi_bear", "doughnut"];

function wpick(pool) {
  const total = pool.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const x of pool) { if ((r -= x.weight) <= 0) return x; }
  return pool[pool.length - 1];
}
function eligiblePlayers(P) { const h = P.filter((p) => !p.is_bot); return h.length ? h : P; }

// Resolve a gift into concrete effects on the current match state.
export function giftEffect(giftType, room, players, opts = {}) {
  const P = players.map((p) => ({ ...p }));
  const byId = Object.fromEntries(P.map((p) => [p.id, p]));
  let rage = room.rage, hoard = room.hoard, double_next = room.double_next;
  const modifiers = { ...(room.modifiers || {}) };
  const events = [];
  const meta = GIFT_META[giftType] || { emoji: "🎁", power: "Gift" };
  const sender = opts.senderName || "A viewer";
  const touched = new Set();
  const mark = (p) => touched.add(p.id);
  const grantWard = (p) => { p.warded = true; mark(p); modifiers.wardIds = [...new Set([...(modifiers.wardIds || []), p.id])]; };
  let effect = "", line = "";

  const dragonStrike = () => {
    const exposed = P.filter((p) => !p.warded).sort((a, b) => b.gold - a.gold);
    if (exposed.length) {
      const v = exposed[0]; const burn = Math.round(v.gold * 0.6); v.gold -= burn; mark(v);
      events.push({ kind: "scorch", payload: { name: v.name, amount: burn } });
      events.push({ kind: "awaken", payload: { victims: [v.name] } });
    } else events.push({ kind: "awaken", payload: { victims: [] } });
    rage = 0;
  };

  if (giftType === "rose") {
    const t = pick(eligiblePlayers(P)); t.gold += 1800; mark(t);
    effect = "Dragon's Blessing"; line = `${sender} sent a Rose — ${t.name} receives 1,800 ◈.`;

  } else if (giftType === "finger_heart") {
    const r = wpick([
      { id: "gold", weight: 30 }, { id: "ward", weight: 20 }, { id: "dsneak", weight: 15 },
      { id: "rage", weight: 15 }, { id: "trust", weight: 10 }, { id: "mystery", weight: 10 },
    ]);
    if (r.id === "gold") { const t = pick(eligiblePlayers(P)); t.gold += 750; mark(t); effect = "Golden Favor"; line = `${t.name} gains 750 ◈.`; }
    else if (r.id === "ward") { const t = pick(eligiblePlayers(P)); grantWard(t); effect = "Protective Favor"; line = `${t.name} is Warded this round.`; }
    else if (r.id === "dsneak") { const t = pick(eligiblePlayers(P)); modifiers.doubleSneak = { ...(modifiers.doubleSneak || {}), [t.id]: 2 }; mark(t); effect = "Silent Fortune"; line = `${t.name}'s next Sneak pays double.`; }
    else if (r.id === "rage") { rage = Math.max(0, rage - 10); effect = "Calming Favor"; line = `The dragon settles — Rage −10.`; }
    else if (r.id === "trust") { const t = pick(eligiblePlayers(P)); t.trust = Math.min(100, t.trust + 10); mark(t); effect = "Trusted Favor"; line = `${t.name} gains +10 Trust.`; }
    else { const t = pick(eligiblePlayers(P)); const m = wpick([
        { id: "g500", weight: 45 }, { id: "g1000", weight: 25 }, { id: "t10", weight: 15 }, { id: "ward", weight: 10 }, { id: "g2500", weight: 5 }]);
      effect = "Mystery Favor";
      if (m.id === "g500") { t.gold += 500; line = `${t.name} opened a chest — 500 ◈.`; }
      else if (m.id === "g1000") { t.gold += 1000; line = `${t.name} opened a chest — 1,000 ◈.`; }
      else if (m.id === "t10") { t.trust = Math.min(100, t.trust + 10); line = `${t.name} opened a chest — +10 Trust.`; }
      else if (m.id === "ward") { grantWard(t); line = `${t.name} opened a chest — a Ward!`; }
      else { t.gold += 2500; line = `${t.name} opened a chest — 2,500 ◈!`; }
      mark(t);
    }

  } else if (giftType === "hi_bear") {
    const r = wpick([
      { id: "gold", weight: 30 }, { id: "ward", weight: 20 }, { id: "trust", weight: 20 },
      { id: "freeze", weight: 15 }, { id: "peace", weight: 15 },
    ]);
    if (r.id === "gold") { P.forEach((p) => { p.gold += 300; mark(p); }); effect = "Shared Treasure"; line = "Every hunter receives 300 ◈."; }
    else if (r.id === "ward") { P.forEach(grantWard); effect = "Bear's Shield"; line = "Everyone is Warded this round."; }
    else if (r.id === "trust") { P.forEach((p) => { p.trust = Math.min(100, p.trust + 5); mark(p); }); effect = "Friendly Spirit"; line = "Everyone gains +5 Trust."; }
    else if (r.id === "freeze") { modifiers.rageFrozen = true; effect = "Dragon's Nap"; line = "Rage can't rise this round."; }
    else { modifiers.betrayMult = 0.5; effect = "Peaceful Pact"; line = "Betrayal is half-strength this round."; }

  } else if (giftType === "doughnut") {
    const r = wpick([
      { id: "rage30", weight: 15 }, { id: "goldall", weight: 15 }, { id: "wardall", weight: 12 },
      { id: "dgrab", weight: 12 }, { id: "betray", weight: 10 }, { id: "attack", weight: 8 },
      { id: "reverse", weight: 8 }, { id: "rich", weight: 8 }, { id: "poor", weight: 8 }, { id: "swap", weight: 4 },
    ]);
    if (r.id === "rage30") { rage += 30; effect = "Dragon Snack"; line = "Rage surges +30."; if (rage >= WAKE_AT) dragonStrike(); if (rage > 100) rage = 100; }
    else if (r.id === "goldall") { P.forEach((p) => { p.gold += 1000; mark(p); }); effect = "Sugar Rush"; line = "Every hunter gains 1,000 ◈."; }
    else if (r.id === "wardall") { P.forEach(grantWard); effect = "Glazed Protection"; line = "Everyone is Warded this round."; }
    else if (r.id === "dgrab") { modifiers.grabMult = 2; effect = "Double Dip"; line = "Grabs pay double this round."; }
    else if (r.id === "betray") { modifiers.guaranteedBetray = true; effect = "Backstab Buffet"; line = "Betrayals strike true this round."; }
    else if (r.id === "attack") { effect = "Wake-Up Call"; line = "The dragon wakes and strikes!"; dragonStrike(); }
    else if (r.id === "reverse") { modifiers.reverseLeaderboard = true; effect = "Turn the Table"; line = "Standings are shown reversed."; }
    else if (r.id === "rich") { const t = P.slice().sort((a, b) => b.gold - a.gold)[0]; if (t) { t.gold += 1500; mark(t); } effect = "Golden Glaze"; line = `${t ? t.name : "The leader"} gains 1,500 ◈.`; }
    else if (r.id === "poor") { const t = P.slice().sort((a, b) => a.gold - b.gold)[0]; if (t) { t.gold += 2000; mark(t); } effect = "Underdog Treat"; line = `${t ? t.name : "The underdog"} gains 2,000 ◈.`; }
    else { const A = P.slice().sort((a, b) => b.gold - a.gold)[0]; const B = P.slice().sort((a, b) => a.gold - b.gold)[0];
      if (A && B && A.id !== B.id) { const amt = Math.max(0, Math.floor((A.gold - B.gold) * 0.25)); A.gold -= amt; B.gold += amt; mark(A); mark(B); line = `${A.name} and ${B.name} swap ${fmt(amt)} ◈.`; }
      effect = "Hoard Swap"; }
  }

  P.forEach((p) => { p.gold = Math.max(0, Math.round(p.gold)); p.trust = Math.round(p.trust); });
  rage = Math.max(0, Math.round(rage)); hoard = Math.max(0, Math.round(hoard));

  events.push({ kind: "gift", payload: {
    label: `${meta.emoji} ${meta.power}`, effect, text: line, sender,
    names: [...touched].map((id) => byId[id] && byId[id].name).filter(Boolean),
  }});

  return {
    players: P.map((p) => ({ id: p.id, gold: p.gold, trust: p.trust, warded: p.warded })),
    room: { rage, hoard, double_next, modifiers },
    events,
    alert: { emoji: meta.emoji, power: meta.power, effect, line, sender },
    targets: [...touched],
  };
}
