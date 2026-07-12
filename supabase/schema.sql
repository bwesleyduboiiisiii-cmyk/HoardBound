-- Hoardbound — Dragon's Hoard · Phase 2 schema
-- Paste this whole file into Supabase → SQL Editor → Run.

-- ---------- Tables ----------
create table if not exists rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  host_id     uuid not null,
  status      text not null default 'lobby',   -- lobby | active | resolving | ended
  round       int  not null default 0,
  rage        int  not null default 0,
  hoard       bigint not null default 50000,
  double_next boolean not null default false,
  spell_player uuid,                            -- hunter who may buy the spell this round
  modifiers   jsonb not null default '{}'::jsonb,
  created_at  timestamptz default now()
);

create table if not exists players (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid references rooms(id) on delete cascade,
  name       text not null,
  avatar     text,
  avatar_url text,                              -- uploaded profile picture (data URL)
  is_bot     boolean default false,
  persona    text,
  gold       bigint default 0,
  trust      int default 50,
  warded     boolean default false,
  pact_with  uuid,
  last_take  bigint default 0,
  connected  boolean default true,
  created_at timestamptz default now()
);

create table if not exists moves (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid references rooms(id) on delete cascade,
  player_id  uuid references players(id) on delete cascade,
  round      int not null,
  action     text not null,               -- sneak | grab | low | betray | pact | idle
  target_id  uuid,
  created_at timestamptz default now(),
  unique (room_id, player_id, round)
);

create table if not exists events (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid references rooms(id) on delete cascade,
  round      int,
  kind       text not null,               -- take|betray|betray_fail|oath|pact|scorch|awaken|director|gift
  payload    jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_players_room on players(room_id);
create index if not exists idx_moves_room_round on moves(room_id, round);
create index if not exists idx_events_room on events(room_id, created_at);

-- ---------- Realtime ----------
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table moves;
alter publication supabase_realtime add table events;

-- ---------- Row-level security ----------
-- NOTE: These are permissive DEV policies so the app works immediately with the
-- anon key. Before a public launch, harden per build bible §5.6 (host-only writes
-- to rooms, players may only insert their own moves, etc.).
alter table rooms   enable row level security;
alter table players enable row level security;
alter table moves   enable row level security;
alter table events  enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'dev_all_rooms') then
    create policy dev_all_rooms   on rooms   for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'dev_all_players') then
    create policy dev_all_players on players for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'dev_all_moves') then
    create policy dev_all_moves   on moves   for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'dev_all_events') then
    create policy dev_all_events  on events  for all using (true) with check (true);
  end if;
end $$;

-- Gift power-ups: round modifiers (safe to run on existing rooms tables)
alter table rooms add column if not exists modifiers jsonb not null default '{}'::jsonb;
alter table rooms add column if not exists spell_player uuid;

-- ---------- Season leaderboard (persistent, keyed by hunter name) ----------
create table if not exists leaders (
  name       text primary key,
  games      int not null default 0,
  wins       int not null default 0,
  total_gold bigint not null default 0,
  best_gold  bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table leaders enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'dev_all_leaders') then
    create policy dev_all_leaders on leaders for all using (true) with check (true);
  end if;
end $$;

-- Profile pictures (safe to run on an existing players table)
alter table players add column if not exists avatar_url text;

-- ---------- Accounts (casual gate: username + 5-digit code + profile picture) ----------
create table if not exists accounts (
  username   text primary key,
  code       text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);
alter table accounts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'dev_all_accounts') then
    create policy dev_all_accounts on accounts for all using (true) with check (true);
  end if;
end $$;
