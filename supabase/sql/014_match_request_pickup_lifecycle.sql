alter table public.match_requests
add column if not exists pickup_confirmed_at timestamptz,
add column if not exists pickup_confirmed_by text;

alter table public.match_requests
drop constraint if exists match_requests_status_check;

alter table public.match_requests
add constraint match_requests_status_check
check (status in ('submitted', 'approved', 'rejected', 'cancelled', 'picked_up'));

create index if not exists idx_match_requests_status_created_at
on public.match_requests (status, created_at desc);

create index if not exists idx_match_requests_status_reviewer
on public.match_requests (status, reviewer_user_id, reviewed_at desc);