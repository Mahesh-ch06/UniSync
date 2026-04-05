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
  updated_at timestamptz not null default now(),
  constraint user_profiles_display_name_len check (
    display_name is null or char_length(trim(display_name)) between 2 and 80
  ),
  constraint user_profiles_campus_len check (
    campus_name is null or char_length(trim(campus_name)) between 2 and 80
  ),
  constraint user_profiles_department_len check (
    department is null or char_length(trim(department)) between 2 and 80
  ),
  constraint user_profiles_year_range check (
    year_of_study is null or year_of_study between 1 and 8
  ),
  constraint user_profiles_phone_len check (
    phone is null or char_length(trim(phone)) between 6 and 24
  ),
  constraint user_profiles_bio_len check (
    bio is null or char_length(trim(bio)) <= 280
  )
);

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

alter table public.user_profiles enable row level security;

drop policy if exists user_profiles_select_self_or_public on public.user_profiles;
create policy user_profiles_select_self_or_public
on public.user_profiles
for select
to authenticated
using (
  user_id = auth.jwt() ->> 'sub'
  or public_profile = true
);

drop policy if exists user_profiles_insert_self on public.user_profiles;
create policy user_profiles_insert_self
on public.user_profiles
for insert
to authenticated
with check (user_id = auth.jwt() ->> 'sub');

drop policy if exists user_profiles_update_self on public.user_profiles;
create policy user_profiles_update_self
on public.user_profiles
for update
to authenticated
using (user_id = auth.jwt() ->> 'sub')
with check (user_id = auth.jwt() ->> 'sub');

create or replace function public.get_my_profile_summary()
returns table (
  user_id text,
  total_points integer,
  level text,
  items_reported integer,
  claims_submitted integer,
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
    select auth.jwt() ->> 'sub' as user_id
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
      count(*) filter (where mr.status = 'approved')::integer as claims_approved,
      count(*) filter (where mr.status = 'picked_up')::integer as claims_picked_up,
      max(mr.created_at) as last_claimed_at
    from public.match_requests mr
    where mr.claimant_user_id = (select user_id from me)
  )
  select
    (select user_id from me) as user_id,
    coalesce((select total_points from points), 0) as total_points,
    coalesce((select level from points), 'Seed') as level,
    coalesce((select items_reported from found), 0) as items_reported,
    coalesce((select claims_submitted from claims), 0) as claims_submitted,
    coalesce((select claims_approved from claims), 0) as claims_approved,
    coalesce((select claims_picked_up from claims), 0) as claims_picked_up,
    greatest(
      coalesce((select updated_at from points), to_timestamp(0)),
      coalesce((select last_reported_at from found), to_timestamp(0)),
      coalesce((select last_claimed_at from claims), to_timestamp(0))
    ) as last_activity_at;
$$;

grant execute on function public.get_my_profile_summary() to authenticated;
