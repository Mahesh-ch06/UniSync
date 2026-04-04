select
  id,
  found_item_id,
  lost_item_id,
  claimant_user_id,
  reviewer_user_id,
  match_score,
  status,
  created_at,
  reviewed_at,
  pickup_confirmed_at,
  pickup_confirmed_by
from public.match_requests
order by created_at desc
limit 40;