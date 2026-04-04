create extension if not exists pg_trgm;

create or replace function public.infer_campus_zone(location_text text)
returns text
language sql
immutable
as $$
  select case
    when location_text is null or btrim(location_text) = '' then 'General'
    when lower(location_text) ~ '(library|lab|lecture|class|department|auditorium|faculty|block|hall|studio|academic)' then 'Academic'
    when lower(location_text) ~ '(hostel|dorm|residence|residential|room|wing|tower)' then 'Residence'
    when lower(location_text) ~ '(gate|parking|bus|stop|station|shuttle|bike|road|metro)' then 'Transit'
    when lower(location_text) ~ '(canteen|cafe|cafeteria|food|court|sports|gym|center|centre|plaza|lawn)' then 'Commons'
    else 'General'
  end;
$$;

alter table public.found_items
add column if not exists campus_zone text
generated always as (public.infer_campus_zone(location)) stored;

create index if not exists idx_found_items_category_created_at
on public.found_items (category, created_at desc);

create index if not exists idx_found_items_zone_created_at
on public.found_items (campus_zone, created_at desc);

create index if not exists idx_found_items_location_search
on public.found_items using gin (lower(location) gin_trgm_ops);

create or replace view public.v_home_hotspot_radar
with (security_invoker = true)
as
with base as (
  select
    coalesce(nullif(btrim(split_part(location, ',', 1)), ''), 'Campus location') as location_hub,
    campus_zone,
    created_at
  from public.found_items
),
aggregated as (
  select
    location_hub,
    campus_zone,
    count(*)::int as total_reports,
    count(*) filter (where created_at >= now() - interval '24 hours')::int as reports_last_24h,
    count(*) filter (
      where created_at < now() - interval '24 hours'
      and created_at >= now() - interval '48 hours'
    )::int as reports_previous_24h
  from base
  group by location_hub, campus_zone
)
select
  location_hub,
  campus_zone,
  total_reports,
  reports_last_24h,
  reports_previous_24h,
  (reports_last_24h - reports_previous_24h)::int as trend_delta
from aggregated
order by total_reports desc, reports_last_24h desc, location_hub asc;

create or replace view public.v_home_campus_pulse
with (security_invoker = true)
as
with scored as (
  select
    id,
    title,
    category,
    location,
    campus_zone,
    created_at,
    (
      case
        when lower(category) ~ '(id|identity|wallet|card|passport)' then 34
        when lower(category) ~ '(key|keys)' then 30
        when lower(category) ~ '(laptop|phone|tablet|electronic|device|charger|earbuds|headphone)' then 28
        when lower(category) ~ '(bag|backpack|pouch)' then 22
        else 16
      end
      + case campus_zone
        when 'Academic' then 20
        when 'Transit' then 18
        when 'Commons' then 15
        when 'Residence' then 12
        else 10
      end
      + case
        when created_at >= now() - interval '3 hours' then 40
        when created_at >= now() - interval '12 hours' then 34
        when created_at >= now() - interval '24 hours' then 30
        when created_at >= now() - interval '72 hours' then 22
        when created_at >= now() - interval '7 days' then 16
        else 10
      end
    )::int as recovery_score
  from public.found_items
),
dominant_zone as (
  select
    campus_zone,
    count(*)::int as zone_reports
  from scored
  group by campus_zone
  order by zone_reports desc, campus_zone asc
  limit 1
),
fresh as (
  select count(*)::int as fresh_reports_24h
  from scored
  where created_at >= now() - interval '24 hours'
),
top_lead as (
  select
    id,
    title,
    location,
    campus_zone,
    recovery_score
  from scored
  order by recovery_score desc, created_at desc
  limit 1
),
top_hotspot as (
  select
    location_hub,
    campus_zone,
    total_reports,
    trend_delta
  from public.v_home_hotspot_radar
  limit 1
)
select
  dominant_zone.campus_zone as dominant_zone,
  dominant_zone.zone_reports,
  fresh.fresh_reports_24h,
  top_hotspot.location_hub as hotspot_location,
  top_hotspot.campus_zone as hotspot_zone,
  top_hotspot.total_reports as hotspot_reports,
  top_hotspot.trend_delta as hotspot_trend,
  top_lead.id as top_lead_id,
  top_lead.title as top_lead_title,
  top_lead.location as top_lead_location,
  top_lead.campus_zone as top_lead_zone,
  top_lead.recovery_score as top_lead_recovery_score,
  case dominant_zone.campus_zone
    when 'Academic' then
      case
        when extract(hour from now()) < 10 then '10:50 class-switch sweep'
        when extract(hour from now()) < 13 then '13:10 lunch transition sweep'
        when extract(hour from now()) < 17 then '16:40 class-closing sweep'
        when extract(hour from now()) < 20 then '19:00 evening lab sweep'
        else 'Tomorrow 10:50 class-switch sweep'
      end
    when 'Residence' then
      case
        when extract(hour from now()) < 9 then '08:30 morning checkout sweep'
        when extract(hour from now()) < 18 then '18:30 return-to-hostel sweep'
        when extract(hour from now()) < 22 then '21:15 quiet-hours sweep'
        else 'Tomorrow 08:30 morning checkout sweep'
      end
    when 'Transit' then
      case
        when extract(hour from now()) < 11 then '09:00 commute peak sweep'
        when extract(hour from now()) < 16 then '15:45 afternoon departure sweep'
        when extract(hour from now()) < 20 then '18:20 evening commute sweep'
        else 'Tomorrow 09:00 commute peak sweep'
      end
    when 'Commons' then
      case
        when extract(hour from now()) < 11 then '11:50 meal-rush sweep'
        when extract(hour from now()) < 17 then '16:10 activity changeover sweep'
        when extract(hour from now()) < 21 then '20:00 event closeout sweep'
        else 'Tomorrow 11:50 meal-rush sweep'
      end
    else
      case
        when extract(hour from now()) < 12 then '12:00 midday sweep'
        when extract(hour from now()) < 18 then '17:30 evening sweep'
        else 'Tomorrow 12:00 midday sweep'
      end
  end as next_sweep_window
from dominant_zone
cross join fresh
cross join top_lead
cross join top_hotspot;

grant select on public.v_home_hotspot_radar to anon, authenticated;
grant select on public.v_home_campus_pulse to anon, authenticated;