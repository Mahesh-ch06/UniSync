-- Ensures profile/settings schema compatibility for backend routes:
-- /api/profile/me and /api/settings/me

create table if not exists public.user_profiles (
  user_id text primary key,
  display_name text,
  campus_name text,
  department text,
  year_of_study smallint,
  phone text,
  bio text,
  avatar_url text,
  notify_claim_updates boolean not null default true,
  notify_messages boolean not null default true,
  public_profile boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles
  add column if not exists display_name text;

alter table public.user_profiles
  add column if not exists campus_name text;

alter table public.user_profiles
  add column if not exists department text;

alter table public.user_profiles
  add column if not exists year_of_study smallint;

alter table public.user_profiles
  add column if not exists phone text;

alter table public.user_profiles
  add column if not exists bio text;

alter table public.user_profiles
  add column if not exists avatar_url text;

alter table public.user_profiles
  add column if not exists notify_claim_updates boolean default true;

alter table public.user_profiles
  add column if not exists notify_messages boolean default true;

alter table public.user_profiles
  add column if not exists public_profile boolean default false;

alter table public.user_profiles
  add column if not exists created_at timestamptz default now();

alter table public.user_profiles
  add column if not exists updated_at timestamptz default now();

update public.user_profiles
set notify_claim_updates = true
where notify_claim_updates is null;

update public.user_profiles
set notify_messages = true
where notify_messages is null;

update public.user_profiles
set public_profile = false
where public_profile is null;

alter table public.user_profiles
  alter column notify_claim_updates set default true;

alter table public.user_profiles
  alter column notify_messages set default true;

alter table public.user_profiles
  alter column public_profile set default false;

alter table public.user_profiles
  alter column notify_claim_updates set not null;

alter table public.user_profiles
  alter column notify_messages set not null;

alter table public.user_profiles
  alter column public_profile set not null;

create index if not exists idx_user_profiles_updated_at
on public.user_profiles (updated_at desc);

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_user_profiles_set_updated_at on public.user_profiles;

create trigger trg_user_profiles_set_updated_at
before update on public.user_profiles
for each row
execute function public.set_row_updated_at();

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

drop function if exists public.get_my_profile_summary();

create function public.get_my_profile_summary()
returns table (
  user_id text,
  total_points integer,
  level text,
  items_reported integer,
  claims_submitted integer,
  claims_in_progress integer,
  claims_approved integer,
  claims_picked_up integer,
  last_activity_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with me as (
    select public.current_request_user_id() as user_id
  ),
  points as (
    select up.total_points, up.level, up.updated_at
    from public.user_points up
    where up.user_id = (select user_id from me)
  ),
  found as (
    select
      count(*)::integer as items_reported,
      max(fi.created_at) as last_reported_at
    from public.found_items fi
    where fi.created_by = (select user_id from me)
  ),
  claims as (
    select
      count(*)::integer as claims_submitted,
      count(*) filter (where mr.status in ('submitted', 'approved'))::integer as claims_in_progress,
      count(*) filter (where mr.status = 'approved')::integer as claims_approved,
      count(*) filter (where mr.status = 'picked_up')::integer as claims_picked_up,
      max(mr.created_at) as last_claimed_at
    from public.match_requests mr
    where mr.claimant_user_id = (select user_id from me)
  ),
  summary as (
    select
      (select user_id from me) as user_id,
      coalesce((select total_points from points), 0) as total_points,
      coalesce((select level from points), 'Seed') as level,
      coalesce((select items_reported from found), 0) as items_reported,
      coalesce((select claims_submitted from claims), 0) as claims_submitted,
      coalesce((select claims_in_progress from claims), 0) as claims_in_progress,
      coalesce((select claims_approved from claims), 0) as claims_approved,
      coalesce((select claims_picked_up from claims), 0) as claims_picked_up,
      greatest(
        coalesce((select updated_at from points), to_timestamp(0)),
        coalesce((select last_reported_at from found), to_timestamp(0)),
        coalesce((select last_claimed_at from claims), to_timestamp(0))
      ) as last_activity_raw
  )
  select
    user_id,
    total_points,
    level,
    items_reported,
    claims_submitted,
    claims_in_progress,
    claims_approved,
    claims_picked_up,
    nullif(last_activity_raw, to_timestamp(0)) as last_activity_at
  from summary;
$$;

grant execute on function public.get_my_profile_summary() to authenticated;
