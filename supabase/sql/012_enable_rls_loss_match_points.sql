alter table public.lost_items enable row level security;
alter table public.match_requests enable row level security;
alter table public.user_points enable row level security;
alter table public.points_ledger enable row level security;

drop policy if exists lost_items_select_public on public.lost_items;
create policy lost_items_select_public
on public.lost_items
for select
to anon, authenticated
using (true);

drop policy if exists lost_items_insert_authenticated on public.lost_items;
create policy lost_items_insert_authenticated
on public.lost_items
for insert
to authenticated
with check (reported_by = auth.jwt() ->> 'sub');

drop policy if exists lost_items_update_owner on public.lost_items;
create policy lost_items_update_owner
on public.lost_items
for update
to authenticated
using (reported_by = auth.jwt() ->> 'sub')
with check (reported_by = auth.jwt() ->> 'sub');

drop policy if exists match_requests_select_owner on public.match_requests;
create policy match_requests_select_owner
on public.match_requests
for select
to authenticated
using (claimant_user_id = auth.jwt() ->> 'sub');

drop policy if exists match_requests_insert_owner on public.match_requests;
create policy match_requests_insert_owner
on public.match_requests
for insert
to authenticated
with check (claimant_user_id = auth.jwt() ->> 'sub');

drop policy if exists user_points_select_owner on public.user_points;
create policy user_points_select_owner
on public.user_points
for select
to authenticated
using (user_id = auth.jwt() ->> 'sub');

drop policy if exists points_ledger_select_owner on public.points_ledger;
create policy points_ledger_select_owner
on public.points_ledger
for select
to authenticated
using (user_id = auth.jwt() ->> 'sub');

drop policy if exists storage_campus_items_public_read on storage.objects;
create policy storage_campus_items_public_read
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'campus-items');

drop policy if exists storage_campus_items_auth_insert on storage.objects;
create policy storage_campus_items_auth_insert
on storage.objects
for insert
to authenticated
with check (bucket_id = 'campus-items');