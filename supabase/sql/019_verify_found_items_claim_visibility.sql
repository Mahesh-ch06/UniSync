-- Should return zero rows when visibility is synced correctly.
with expected as (
  select
    fi.id,
    public.is_found_item_public_visible(fi.id) as expected_visible
  from public.found_items fi
)
select
  fi.id,
  fi.title,
  fi.is_public_visible,
  e.expected_visible
from public.found_items fi
join expected e on e.id = fi.id
where fi.is_public_visible is distinct from e.expected_visible;

-- Quick check of current public feed rows.
select
  id,
  title,
  location,
  is_public_visible,
  created_at
from public.found_items
where is_public_visible = true
order by created_at desc
limit 50;
