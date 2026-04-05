create or replace function public.current_request_user_id()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() ->> 'sub', ''),
    nullif(auth.jwt() ->> 'user_id', ''),
    nullif(auth.jwt() ->> 'uid', '')
  );
$$;

alter table public.user_profiles enable row level security;

drop policy if exists user_profiles_select_self_or_public on public.user_profiles;
create policy user_profiles_select_self_or_public
on public.user_profiles
for select
to authenticated, anon
using (
  public_profile = true
  or user_id = public.current_request_user_id()
);

drop policy if exists user_profiles_insert_self on public.user_profiles;
create policy user_profiles_insert_self
on public.user_profiles
for insert
to authenticated, anon
with check (
  user_id = public.current_request_user_id()
);

drop policy if exists user_profiles_update_self on public.user_profiles;
create policy user_profiles_update_self
on public.user_profiles
for update
to authenticated, anon
using (
  user_id = public.current_request_user_id()
)
with check (
  user_id = public.current_request_user_id()
);
