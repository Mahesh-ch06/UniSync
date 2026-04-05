select
  user_id,
  display_name,
  campus_name,
  department,
  year_of_study,
  notify_claim_updates,
  notify_messages,
  public_profile,
  updated_at
from public.user_profiles
order by updated_at desc
limit 10;

select *
from public.get_my_profile_summary();
