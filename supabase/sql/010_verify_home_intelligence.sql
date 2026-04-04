select
  id,
  title,
  category,
  location,
  campus_zone,
  created_at
from public.found_items
order by created_at desc
limit 20;

select
  location_hub,
  campus_zone,
  total_reports,
  reports_last_24h,
  reports_previous_24h,
  trend_delta
from public.v_home_hotspot_radar
limit 10;

select
  dominant_zone,
  zone_reports,
  fresh_reports_24h,
  hotspot_location,
  hotspot_zone,
  hotspot_reports,
  hotspot_trend,
  top_lead_title,
  top_lead_recovery_score,
  next_sweep_window
from public.v_home_campus_pulse;