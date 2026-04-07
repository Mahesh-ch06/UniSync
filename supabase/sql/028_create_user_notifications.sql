create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  type text not null default 'general',
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  request_id text,
  found_item_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_notifications_user_id
on public.user_notifications (user_id);

create index if not exists idx_user_notifications_created_at
on public.user_notifications (created_at desc);

create index if not exists idx_user_notifications_user_created
on public.user_notifications (user_id, created_at desc);

alter table public.user_notifications enable row level security;

drop policy if exists user_notifications_select_self on public.user_notifications;
create policy user_notifications_select_self
on public.user_notifications
for select
to authenticated, anon
using (user_id = public.current_request_user_id());

drop policy if exists user_notifications_insert_self on public.user_notifications;
create policy user_notifications_insert_self
on public.user_notifications
for insert
to authenticated, anon
with check (user_id = public.current_request_user_id());

drop policy if exists user_notifications_update_self on public.user_notifications;
create policy user_notifications_update_self
on public.user_notifications
for update
to authenticated, anon
using (user_id = public.current_request_user_id())
with check (user_id = public.current_request_user_id());

drop policy if exists user_notifications_delete_self on public.user_notifications;
create policy user_notifications_delete_self
on public.user_notifications
for delete
to authenticated, anon
using (user_id = public.current_request_user_id());
