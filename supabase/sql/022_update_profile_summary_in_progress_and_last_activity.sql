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
