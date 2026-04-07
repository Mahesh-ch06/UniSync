create table if not exists public.push_device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  expo_push_token text not null,
  platform text not null default 'unknown',
  device_label text,
  app_version text,
  is_active boolean not null default true,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_device_tokens_unique_user_token unique (user_id, expo_push_token)
);

create index if not exists idx_push_device_tokens_user_id
on public.push_device_tokens (user_id);

create index if not exists idx_push_device_tokens_active
on public.push_device_tokens (is_active);

create index if not exists idx_push_device_tokens_updated_at
on public.push_device_tokens (updated_at desc);

create or replace function public.set_push_device_tokens_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_push_device_tokens_set_updated_at on public.push_device_tokens;

create trigger trg_push_device_tokens_set_updated_at
before update on public.push_device_tokens
for each row
execute function public.set_push_device_tokens_updated_at();

alter table public.push_device_tokens enable row level security;

drop policy if exists push_device_tokens_select_self on public.push_device_tokens;
create policy push_device_tokens_select_self
on public.push_device_tokens
for select
to authenticated, anon
using (user_id = public.current_request_user_id());

drop policy if exists push_device_tokens_insert_self on public.push_device_tokens;
create policy push_device_tokens_insert_self
on public.push_device_tokens
for insert
to authenticated, anon
with check (user_id = public.current_request_user_id());

drop policy if exists push_device_tokens_update_self on public.push_device_tokens;
create policy push_device_tokens_update_self
on public.push_device_tokens
for update
to authenticated, anon
using (user_id = public.current_request_user_id())
with check (user_id = public.current_request_user_id());

drop policy if exists push_device_tokens_delete_self on public.push_device_tokens;
create policy push_device_tokens_delete_self
on public.push_device_tokens
for delete
to authenticated, anon
using (user_id = public.current_request_user_id());
