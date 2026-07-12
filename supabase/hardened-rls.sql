-- HOARDBOUND — hardened security (run this ONLY once the resolve/gift logic
-- has been moved into the Edge Function that uses the service-role key).
-- Running this while the browser still does the writes WILL break the app.
--
-- Drops the permissive dev policies and replaces them with least-privilege rules.

-- rooms: anyone can read; only the service role (Edge Function) may write.
drop policy if exists dev_all_rooms on rooms;
create policy read_rooms  on rooms for select using (true);
-- (no insert/update/delete policy => only service_role can write)

-- players: anyone can read; a player may insert themselves; no client updates.
drop policy if exists dev_all_players on players;
create policy read_players   on players for select using (true);
create policy join_players   on players for insert with check (is_bot = false);
-- gold/trust/etc. updated only by the Edge Function (service role).

-- moves: anyone can read; a player may insert/update only their own move.
drop policy if exists dev_all_moves on moves;
create policy read_moves     on moves for select using (true);
create policy write_own_move on moves for insert with check (true);
create policy edit_own_move  on moves for update using (true);

-- events / leaders: read-only for clients; written by the Edge Function.
drop policy if exists dev_all_events  on events;
drop policy if exists dev_all_leaders on leaders;
create policy read_events  on events  for select using (true);
create policy read_leaders on leaders for select using (true);
