select id, title, category, expected_location, status, reported_by, created_at
from public.lost_items
order by created_at desc
limit 20;

select id, found_item_id, lost_item_id, claimant_user_id, match_score, status, created_at
from public.match_requests
order by created_at desc
limit 20;

select user_id, total_points, level, updated_at
from public.user_points
order by updated_at desc
limit 20;

select id, user_id, points, reason, reference_type, reference_id, created_at
from public.points_ledger
order by created_at desc
limit 30;

select public.compute_points_level(0) as level_seed,
       public.compute_points_level(60) as level_scout,
       public.compute_points_level(400) as level_guardian;