create extension if not exists pgcrypto;

create table if not exists public.lost_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text not null default 'General',
  expected_location text,
  image_url text,
  ai_detected_label text,
  reported_by text not null,
  status text not null default 'open' check (status in ('open', 'matched', 'claimed', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.match_requests (
  id uuid primary key default gen_random_uuid(),
  found_item_id uuid not null references public.found_items(id) on delete cascade,
  lost_item_id uuid not null references public.lost_items(id) on delete cascade,
  claimant_user_id text not null,
  proof_image_url text,
  ai_detected_label text,
  match_score int not null default 0 check (match_score between 0 and 100),
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_user_id text
);

create table if not exists public.user_points (
  user_id text primary key,
  total_points int not null default 0 check (total_points >= 0),
  level text not null default 'Seed',
  updated_at timestamptz not null default now()
);

create table if not exists public.points_ledger (
  id bigserial primary key,
  user_id text not null,
  points int not null,
  reason text not null,
  reference_type text,
  reference_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_lost_items_status_created_at
on public.lost_items (status, created_at desc);

create index if not exists idx_lost_items_reported_by
on public.lost_items (reported_by, created_at desc);

create index if not exists idx_match_requests_claimant_created_at
on public.match_requests (claimant_user_id, created_at desc);

create index if not exists idx_match_requests_found_item
on public.match_requests (found_item_id, created_at desc);

create index if not exists idx_points_ledger_user_created_at
on public.points_ledger (user_id, created_at desc);

create unique index if not exists idx_match_requests_one_active_claim
on public.match_requests (found_item_id, claimant_user_id)
where status = 'submitted';

create or replace function public.set_row_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_lost_items_set_updated_at on public.lost_items;

create trigger trg_lost_items_set_updated_at
before update on public.lost_items
for each row
execute function public.set_row_updated_at();

create or replace function public.compute_points_level(total integer)
returns text
language sql
immutable
as $$
  select case
    when total >= 1200 then 'Legend'
    when total >= 700 then 'Champion'
    when total >= 350 then 'Guardian'
    when total >= 150 then 'Tracker'
    when total >= 50 then 'Scout'
    else 'Seed'
  end;
$$;

create or replace function public.award_points(
  p_user_id text,
  p_points integer,
  p_reason text,
  p_reference_type text default null,
  p_reference_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta integer := coalesce(p_points, 0);
  v_next_total integer;
begin
  if p_user_id is null or btrim(p_user_id) = '' then
    raise exception 'p_user_id is required';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'p_reason is required';
  end if;

  insert into public.user_points (user_id, total_points, level)
  values (p_user_id, greatest(v_delta, 0), public.compute_points_level(greatest(v_delta, 0)))
  on conflict (user_id)
  do update set
    total_points = greatest(public.user_points.total_points + v_delta, 0),
    level = public.compute_points_level(greatest(public.user_points.total_points + v_delta, 0)),
    updated_at = now()
  returning total_points into v_next_total;

  insert into public.points_ledger (user_id, points, reason, reference_type, reference_id)
  values (p_user_id, v_delta, p_reason, p_reference_type, p_reference_id);

  update public.user_points
  set level = public.compute_points_level(v_next_total),
      updated_at = now()
  where user_id = p_user_id;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'campus-items',
  'campus-items',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;