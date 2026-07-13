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

export const ACT_LABEL = { sneak: "🪙 Sneaking", grab: "💰 Grabbing", low: "🌑 Lying low", betray: "🗡️ Betraying", pact: "🤝 Forming a pact", spell: "✨ Casting a spell", idle: "…" };

// ===== Special spell move — one random hunter each round may buy it for 3,000◈ =====
// Buying it triggers ONE of these at random. These are unique to spellcasting.
export const SPELL_COST = 3000;
export const SPELLS = [
  { id: "siphon",  name: "Arcane Siphon" },   // drain 20% from every other hunter
  { id: "lullaby", name: "Dragon's Lullaby" },// soothe the dragon: rage −45
  { id: "stone",   name: "Philosopher's Stone" }, // transmute: own gold ×1.6
  { id: "rift",    name: "Hoard Rift" },      // tear 4,500◈ straight from the hoard
  { id: "mirror",  name: "Mirror Curse" },    // richest rival loses 35% (vanishes)
  { id: "phantom", name: "Phantom Step" },    // become Warded + gain 1,800◈
  { id: "wild",    name: "Wild Magic" },      // everyone's gold randomly redistributed
  { id: "gamble",  name: "Golden Gamble" },   // coin flip: own gold ×2, or halved
];
export const SPELL_IDS = SPELLS.map((s) => s.id);

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
  // if this bot is the round's chosen caster and can afford it, sometimes gamble on a spell
  if (room.spell_player === bot.id && bot.gold >= SPELL_COST && Math.random() < 0.4) return { action: "spell" };
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

  // 2.6 spellcasting — a bought spell (3,000◈) fires a random arcane effect
  P.forEach((p) => {
    if (p.choice.action !== "spell") return;
    if (p.gold < SPELL_COST) { push("move", { name: p.name, action: "idle" }); return; }
    p.gold -= SPELL_COST;
    const spell = pick(SPELL_IDS);
    const others = P.filter((x) => x.id !== p.id);
    let line = "", name = "";
    if (spell === "siphon") {
      name = "Arcane Siphon";
      let took = 0;
      others.forEach((o) => { const cut = Math.round(o.gold * 0.20); o.gold -= cut; took += cut; });
      p.gold += took; p.last_take += took; addRage(6);
      line = `drains 20% from every rival — ${fmt(took)} ◈ siphoned away.`;
    } else if (spell === "lullaby") {
      name = "Dragon's Lullaby"; rage = Math.max(0, rage - 45);
      line = `sings the dragon back toward sleep — its rage falls by 45.`;
    } else if (spell === "stone") {
      name = "Philosopher's Stone"; const before = p.gold;
      p.gold = Math.round(p.gold * 1.6); addRage(8);
      line = `transmutes their hoard — ${fmt(before)} ◈ becomes ${fmt(p.gold)} ◈.`;
    } else if (spell === "rift") {
      name = "Hoard Rift"; const amt = Math.min(hoard, 4500);
      hoard -= amt; p.gold += amt; p.last_take += amt; addRage(14);
      line = `tears a rift in the hoard and pulls out ${fmt(amt)} ◈.`;
    } else if (spell === "mirror") {
      name = "Mirror Curse";
      const rich = others.slice().sort((a, b) => b.gold - a.gold)[0];
      if (rich) { const loss = Math.round(rich.gold * 0.35); rich.gold -= loss;
        line = `curses ${rich.name}, vanishing 35% of their gold (${fmt(loss)} ◈).`;
      } else line = `casts a curse into an empty room.`;
      addRage(4);
    } else if (spell === "phantom") {
      name = "Phantom Step"; p.warded = true; const amt = Math.min(hoard, 1800);
      hoard -= amt; p.gold += amt; p.last_take += amt;
      line = `steps between moments — Warded, and ${fmt(amt)} ◈ richer.`;
    } else if (spell === "wild") {
      name = "Wild Magic";
      const pot = P.reduce((s, x) => s + x.gold, 0);
      const shares = P.map(() => Math.random());
      const sum = shares.reduce((a, b) => a + b, 0) || 1;
      P.forEach((x, i) => { x.gold = Math.round(pot * (shares[i] / sum)); });
      addRage(10);
      line = `unleashes Wild Magic — everyone's gold is flung to the winds and redealt.`;
    } else { // gamble
      name = "Golden Gamble"; const win = Math.random() < 0.5;
      const before = p.gold; p.gold = win ? p.gold * 2 : Math.round(p.gold / 2);
      addRage(6);
      line = win ? `gambles and WINS — ${fmt(before)} ◈ doubled to ${fmt(p.gold)} ◈!`
                 : `gambles and LOSES — ${fmt(before)} ◈ cut to ${fmt(p.gold)} ◈.`;
    }
    push("spell", { name: p.name, spell: name, text: line });
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
  if (kind === "spell") return "spell";
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
    case "spell": return `✨ <b>${p.name}</b> cast <b>${p.spell}</b> — ${p.text}`;
    default: return "";
  }
}

// Plain-text dramatic narration for the post-round recap (spoken + shown).
// A menacing first-person line the dragon roars whenever it scorches a hunter.
export function dragonScorchLine(name, amount) {
  const who = name || "thief";
  const amt = amount ? fmt(amount) : "your gold";
  return pick([
    `Foolish ${who}! ${amt} gold — ash in my jaws.`,
    `You reached too far, ${who}. Burn for it — ${amt} gone!`,
    `Did you think me asleep, ${who}? ${amt} scorched to nothing!`,
    `Greedy little ${who}… ${amt}, now only cinders.`,
    `Mine. All of it, ${who}. ${amt} returns to the flame!`,
    `You should have stayed in the shadows, ${who}.`,
    `Tremble, ${who}. ${amt} devoured — and still I hunger.`,
  ]);
}

export function narrationLine(e) {
  const p = e.payload || {};
  switch (e.kind) {
    case "move":
      if (p.action === "grab") return `${p.name} lunged for the gold and hauled out ${fmt(p.amount)}.`;
      if (p.action === "sneak") return `${p.name} crept in quietly and slipped away with ${fmt(p.amount)}.`;
      if (p.action === "low") return `${p.name} lay low in the shadows, warded from harm.`;
      return `${p.name} held back this round.`;
    case "betray": return `${p.from} turned on ${p.to}, snatching ${fmt(p.amount)}!`;
    case "betray_fail": return `${p.from} struck at ${p.to} — but they had already vanished.`;
    case "oath": return `Betrayal! ${p.from} shattered the pact and gutted ${p.to} for ${fmt(p.amount)}.`;
    case "pact": return `The pact between allies held — ${p.name} earned a bonus.`;
    case "pact_offer": return `${p.name} extended a hand of alliance to ${p.to}.`;
    case "pact_sealed": return `${p.a} and ${p.b} sealed a pact of gold.`;
    case "spell": return `${p.name} unleashed ${p.spell} — ${p.text}`;
    case "scorch": return `The dragon's fire found ${p.name}, and ${fmt(p.amount)} turned to ash.`;
    case "awaken": return p.victims && p.victims.length
      ? `The dragon awakens in fury — ${p.victims.join(" and ")} burned for their greed!`
      : `The dragon stirred, but the wary slipped into shadow.`;
    default: return "";
  }
}

// Which dragon artwork to show for a given rage level.
export function rageStage(rage) {
  return rage >= 85 ? "attack" : rage >= 45 ? "awake" : "sleep";
}

/* ============================ GIFT POWER-UPS ============================ */
export const GIFT_VALUES = {
  treasure_box: 1, lightning_bolt: 1, shard_hope: 1, dragons_breath: 1, claw_swipe: 5, tail_lash: 10, wing_gust: 10, ember_storm: 25,
  fireball: 100, scorch_earth: 199, pirates_treasure: 449, money_gun: 500, warrior_shell: 500, sound_spell: 500, gold_mine: 1000, lovers_lock: 1500,
  dragon_bite: 2000, meteor_storm: 3000, dragon_flame: 26999, tiktok_universe: 44999,
};
export const GIFT_META = {
  treasure_box:    { emoji: "📦", power: "Treasure Box",     coins: 1,     blurb: "Tiny treasure — +400 ◈ to a random hunter." },
  lightning_bolt:  { emoji: "⚡", power: "Storm Bolt",        coins: 1,     blurb: "Feeds the dragon — Rage +8." },
  shard_hope:      { emoji: "🔷", power: "Shard of Hope",     coins: 1,     blurb: "A random hunter gets a small Ward or +Trust." },
  dragons_breath:  { emoji: "🔥", power: "Dragon's Breath",   coins: 1,     blurb: "Cheap attack — dragon burns ONE random hunter (−25%)." },
  claw_swipe:      { emoji: "🐾", power: "Claw Swipe",        coins: 5,     blurb: "Dragon claws ONE random hunter (−30%)." },
  tail_lash:       { emoji: "🐉", power: "Tail Lash",         coins: 10,    blurb: "Dragon's tail hits ONE random hunter (−40%)." },
  wing_gust:       { emoji: "🌪️", power: "Wing Gust",         coins: 10,    blurb: "Buffets TWO random hunters (−20% each)." },
  ember_storm:     { emoji: "🌋", power: "Ember Storm",       coins: 25,    blurb: "Embers singe a random THIRD of the lobby (−20% each)." },
  fireball:        { emoji: "☄️", power: "Fireball",          coins: 100,   blurb: "Hits ONE random hunter hard (−45%)." },
  scorch_earth:    { emoji: "🔥", power: "Scorched Earth",    coins: 199,   blurb: "EVERY hunter loses 15% (non-lethal)." },
  pirates_treasure:{ emoji: "🏴‍☠️", power: "Pirate's Treasure", coins: 449, blurb: "+1,200 ◈ to a random hunter." },
  money_gun:       { emoji: "💵", power: "Money Gun",         coins: 500,   blurb: "Gold rain — +2,200 ◈ to a random hunter." },
  warrior_shell:   { emoji: "🛡️", power: "Warrior's Shell",   coins: 500,   blurb: "Shields a random hunter from the dragon." },
  sound_spell:     { emoji: "🎵", power: "Sound Spell",       coins: 500,   blurb: "A random hunter casts a random spell." },
  gold_mine:       { emoji: "⛏️", power: "Gold Mine",         coins: 1000,  blurb: "Jackpot — +4,000 ◈ to a random hunter." },
  lovers_lock:     { emoji: "🔒", power: "Lover's Lock",      coins: 1500,  blurb: "Seals a pact between two random hunters." },
  dragon_bite:     { emoji: "🐲", power: "Dragon's Bite",     coins: 2000,  blurb: "The dragon attacks ONE random hunter (−60% gold)." },
  meteor_storm:    { emoji: "☄️", power: "Meteor Storm",      coins: 3000,  blurb: "Randomly scorches HALF the lobby for 50% of their gold." },
  dragon_flame:    { emoji: "🐉", power: "Dragon Flame",      coins: 26999, blurb: "The dragon scorches EVERY hunter to 0 ◈!" },
  tiktok_universe: { emoji: "🌌", power: "TikTok Universe",   coins: 44999, blurb: "Cosmic jackpot — +5,000 ◈ to EVERY hunter." },
};
export const GIFT_ORDER = [
  "treasure_box", "lightning_bolt", "shard_hope", "dragons_breath", "claw_swipe", "tail_lash", "wing_gust", "ember_storm",
  "fireball", "scorch_earth", "pirates_treasure", "money_gun", "warrior_shell", "sound_spell", "gold_mine", "lovers_lock",
  "dragon_bite", "meteor_storm", "dragon_flame", "tiktok_universe",
];

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

  if (giftType === "treasure_box") {
    const t = pick(eligiblePlayers(P)); t.gold += 400; mark(t);
    effect = "Treasure Box"; line = `${sender} tossed ${t.name} a Treasure Box — +400 ◈.`;

  } else if (giftType === "lightning_bolt") {
    rage += 8; effect = "Storm Bolt"; line = `${sender} feeds the dragon — Rage +8.`;
    if (rage >= WAKE_AT) dragonStrike();
    if (rage > 100) rage = 100;

  } else if (giftType === "shard_hope") {
    const t = pick(eligiblePlayers(P));
    if (Math.random() < 0.5) { grantWard(t); effect = "Shard of Hope"; line = `${t.name} is shielded by a Shard of Hope — Warded.`; }
    else { t.trust = Math.min(100, t.trust + 8); mark(t); effect = "Shard of Hope"; line = `${t.name} takes heart — +8 Trust.`; }

  } else if (giftType === "pirates_treasure") {
    const t = pick(eligiblePlayers(P)); t.gold += 1200; mark(t);
    effect = "Pirate's Treasure"; line = `${sender} handed ${t.name} a Pirate's Treasure — +1,200 ◈.`;

  } else if (giftType === "money_gun") {
    const t = pick(eligiblePlayers(P)); t.gold += 2200; mark(t);
    effect = "Money Gun"; line = `${sender} sprayed gold on ${t.name} — +2,200 ◈.`;

  } else if (giftType === "warrior_shell") {
    const t = pick(eligiblePlayers(P)); grantWard(t);
    effect = "Warrior's Shell"; line = `${t.name} raises a Warrior's Shell — Warded from the dragon this round.`;

  } else if (giftType === "sound_spell") {
    const t = pick(eligiblePlayers(P));
    const s = wpick([
      { id: "siphon", weight: 20 }, { id: "lullaby", weight: 18 }, { id: "stone", weight: 18 },
      { id: "rift", weight: 16 }, { id: "phantom", weight: 16 }, { id: "gamble", weight: 12 },
    ]);
    if (s.id === "siphon") { let drained = 0; P.forEach((o) => { if (o.id !== t.id) { const d = Math.round(o.gold * 0.2); o.gold -= d; drained += d; mark(o); } }); t.gold += drained; mark(t); effect = "Arcane Siphon"; line = `${t.name} casts Arcane Siphon — drains ${fmt(drained)} ◈ from the others.`; }
    else if (s.id === "lullaby") { rage = Math.max(0, rage - 45); effect = "Dragon's Lullaby"; line = `${t.name} casts Dragon's Lullaby — Rage −45.`; }
    else if (s.id === "stone") { const g = Math.round(t.gold * 0.6); t.gold += g; mark(t); effect = "Philosopher's Stone"; line = `${t.name} casts Philosopher's Stone — gold ×1.6.`; }
    else if (s.id === "rift") { const amt = Math.min(hoard, 4500); hoard -= amt; t.gold += amt; mark(t); effect = "Hoard Rift"; line = `${t.name} casts Hoard Rift — tears ${fmt(amt)} ◈ from the hoard.`; }
    else if (s.id === "phantom") { grantWard(t); t.gold += 1800; mark(t); effect = "Phantom Step"; line = `${t.name} casts Phantom Step — Warded and +1,800 ◈.`; }
    else { if (Math.random() < 0.5) { t.gold = Math.round(t.gold * 2); effect = "Golden Gamble"; line = `${t.name} gambles and WINS — gold doubled!`; } else { t.gold = Math.round(t.gold / 2); effect = "Golden Gamble"; line = `${t.name} gambles and loses — gold halved.`; } mark(t); }

  } else if (giftType === "gold_mine") {
    const t = pick(eligiblePlayers(P)); t.gold += 4000; mark(t);
    effect = "Gold Mine"; line = `${sender} struck a Gold Mine for ${t.name} — +4,000 ◈!`;

  } else if (giftType === "lovers_lock") {
    const hs = eligiblePlayers(P).slice().sort(() => Math.random() - 0.5);
    if (hs.length >= 2) { const a = hs[0], b = hs[1]; a.pact_with = b.id; b.pact_with = a.id; mark(a); mark(b);
      effect = "Lover's Lock"; line = `${sender} sealed a pact — ${a.name} and ${b.name} are now allied!`; }
    else { effect = "Lover's Lock"; line = `${sender} sent a Lover's Lock, but there aren't two hunters to bind.`; }

  } else if (giftType === "tiktok_universe") {
    P.forEach((p) => { p.gold += 5000; mark(p); });
    rage = Math.max(0, rage - 20);
    effect = "TikTok Universe"; line = `${sender} unleashed the TIKTOK UNIVERSE — every hunter showered with 5,000 ◈!`;

  } else if (giftType === "dragons_breath") {
    const t = pick(P); const burn = Math.round(t.gold * 0.25);
    if (burn > 0) { t.gold -= burn; events.push({ kind: "scorch", payload: { name: t.name, amount: burn } }); }
    mark(t); effect = "Dragon's Breath";
    line = burn > 0 ? `${sender} — the dragon breathes fire on ${t.name}! ${fmt(burn)} ◈ scorched.` : `${sender} — the dragon breathes at ${t.name}, but there's nothing to burn.`;

  } else if (giftType === "tail_lash") {
    const t = pick(P); const burn = Math.round(t.gold * 0.4);
    if (burn > 0) { t.gold -= burn; events.push({ kind: "scorch", payload: { name: t.name, amount: burn } }); }
    mark(t); effect = "Tail Lash";
    line = burn > 0 ? `${sender} — the dragon's tail lashes ${t.name}! ${fmt(burn)} ◈ gone.` : `${sender} — the dragon's tail whips past ${t.name}.`;

  } else if (giftType === "ember_storm") {
    const shuffled = P.slice().sort(() => Math.random() - 0.5);
    const n = Math.max(1, Math.ceil(shuffled.length / 3));
    const victims = shuffled.slice(0, n);
    victims.forEach((v) => { const burn = Math.round(v.gold * 0.2); if (burn > 0) { v.gold -= burn; events.push({ kind: "scorch", payload: { name: v.name, amount: burn } }); } mark(v); });
    effect = "Ember Storm"; line = `${sender} rains embers on ${victims.map((v) => v.name).join(", ")} — singed for 20%!`;

  } else if (giftType === "claw_swipe") {
    const t = pick(P); const burn = Math.round(t.gold * 0.3);
    if (burn > 0) { t.gold -= burn; events.push({ kind: "scorch", payload: { name: t.name, amount: burn } }); }
    mark(t); effect = "Claw Swipe";
    line = burn > 0 ? `${sender} — the dragon claws ${t.name}! ${fmt(burn)} ◈ shredded.` : `${sender} — the dragon claws at ${t.name}, nothing to take.`;

  } else if (giftType === "wing_gust") {
    const sh = P.slice().sort(() => Math.random() - 0.5); const vs = sh.slice(0, Math.min(2, sh.length));
    vs.forEach((v) => { const b = Math.round(v.gold * 0.2); if (b > 0) { v.gold -= b; events.push({ kind: "scorch", payload: { name: v.name, amount: b } }); } mark(v); });
    effect = "Wing Gust"; line = `${sender} — a wing gust batters ${vs.map((v) => v.name).join(", ")} for 20%!`;

  } else if (giftType === "fireball") {
    const t = pick(P); const burn = Math.round(t.gold * 0.45);
    if (burn > 0) { t.gold -= burn; events.push({ kind: "scorch", payload: { name: t.name, amount: burn } }); }
    mark(t); events.push({ kind: "awaken", payload: { victims: [t.name] } });
    effect = "Fireball"; line = burn > 0 ? `${sender} hurls a FIREBALL at ${t.name} — ${fmt(burn)} ◈ incinerated!` : `${sender} hurls a fireball at ${t.name}, nothing to burn.`;

  } else if (giftType === "scorch_earth") {
    P.forEach((p) => { const b = Math.round(p.gold * 0.15); if (b > 0) { p.gold -= b; events.push({ kind: "scorch", payload: { name: p.name, amount: b } }); } mark(p); });
    events.push({ kind: "awaken", payload: { victims: P.map((p) => p.name) } });
    effect = "Scorched Earth"; line = `${sender} scorches the earth — EVERY hunter loses 15%!`;

  } else if (giftType === "generic") {
    const r = wpick([{ id: "gold", weight: 55 }, { id: "nibble", weight: 30 }, { id: "rage", weight: 15 }]);
    if (r.id === "gold") { const t = pick(eligiblePlayers(P)); t.gold += 200; mark(t); effect = "Tribute"; line = `${sender} tossed a tribute — ${t.name} +200 ◈.`; }
    else if (r.id === "nibble") { const t = pick(P); const b = Math.round(t.gold * 0.08); if (b > 0) { t.gold -= b; events.push({ kind: "scorch", payload: { name: t.name, amount: b } }); } mark(t); effect = "Dragon Nibble"; line = `${sender}'s gift wakes the dragon — ${t.name} singed for ${fmt(b)} ◈.`; }
    else { rage = Math.min(100, rage + 5); effect = "Stirring"; line = `${sender}'s gift stirs the dragon — Rage +5.`; }

  } else if (giftType === "dragon_flame") {
    // The big one: the dragon torches the entire hoard — every hunter back to 0.
    P.forEach((p) => {
      if (p.gold > 0) { events.push({ kind: "scorch", payload: { name: p.name, amount: p.gold } }); }
      p.gold = 0; mark(p);
    });
    events.push({ kind: "awaken", payload: { victims: P.map((p) => p.name) } });
    rage = 0;
  } else if (giftType === "meteor_storm") {
    // Randomly rains fire on HALF the lobby — each victim loses half their gold.
    const shuffled = P.slice().sort(() => Math.random() - 0.5);
    const n = Math.max(1, Math.ceil(shuffled.length / 2));
    const victims = shuffled.slice(0, n);
    victims.forEach((v) => {
      const burn = Math.round(v.gold * 0.5);
      if (burn > 0) { v.gold -= burn; events.push({ kind: "scorch", payload: { name: v.name, amount: burn } }); }
      mark(v);
    });
    effect = "Meteor Storm";
    line = `${sender} called down a METEOR STORM — ${victims.map((v) => v.name).join(", ")} take a hit!`;

  } else if (giftType === "dragon_bite") {
    // The dragon lunges at ONE random hunter, burning 60% of their gold.
    const t = pick(P);
    const burn = Math.round(t.gold * 0.6);
    if (burn > 0) { t.gold -= burn; events.push({ kind: "scorch", payload: { name: t.name, amount: burn } }); }
    mark(t);
    events.push({ kind: "awaken", payload: { victims: [t.name] } });
    effect = "Dragon's Bite";
    line = burn > 0
      ? `${sender} sent the dragon after ${t.name} — ${fmt(burn)} ◈ scorched to ash!`
      : `${sender} sent the dragon after ${t.name}, but they had nothing to burn!`;
  }

  P.forEach((p) => { p.gold = Math.max(0, Math.round(p.gold)); p.trust = Math.round(p.trust); });
  rage = Math.max(0, Math.round(rage)); hoard = Math.max(0, Math.round(hoard));

  events.push({ kind: "gift", payload: {
    label: `${meta.emoji} ${meta.power}`, effect, text: line, sender,
    names: [...touched].map((id) => byId[id] && byId[id].name).filter(Boolean),
  }});

  return {
    players: P.map((p) => ({ id: p.id, gold: p.gold, trust: p.trust, warded: p.warded, pact_with: p.pact_with })),
    room: { rage, hoard, double_next, modifiers },
    events,
    alert: { emoji: meta.emoji, power: meta.power, effect, line, sender },
    targets: [...touched],
  };
}
