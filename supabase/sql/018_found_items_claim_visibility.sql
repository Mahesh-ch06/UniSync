alter table public.found_items
add column if not exists is_public_visible boolean not null default true;

comment on column public.found_items.is_public_visible is
  'Public feed visibility. False when any active claim exists for this found item.';

create or replace function public.is_found_item_public_visible(p_found_item_id uuid)
returns boolean
language sql
stable
as $$
  select not exists (
    select 1
    from public.match_requests mr
    where mr.found_item_id = p_found_item_id
      and mr.status in ('submitted', 'approved', 'picked_up')
  );
$$;

create or replace function public.sync_found_item_visibility(p_found_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visible boolean;
begin
  if p_found_item_id is null then
    return;
  end if;

  v_visible := public.is_found_item_public_visible(p_found_item_id);

  update public.found_items
  set is_public_visible = v_visible
  where id = p_found_item_id;
end;
$$;

create or replace function public.trg_match_requests_sync_found_visibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.sync_found_item_visibility(old.found_item_id);
    return old;
  end if;

  perform public.sync_found_item_visibility(new.found_item_id);

  if tg_op = 'UPDATE' and new.found_item_id is distinct from old.found_item_id then
    perform public.sync_found_item_visibility(old.found_item_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_match_requests_sync_found_visibility on public.match_requests;

create trigger trg_match_requests_sync_found_visibility
after insert or update or delete on public.match_requests
for each row
execute function public.trg_match_requests_sync_found_visibility();

update public.found_items fi
set is_public_visible = public.is_found_item_public_visible(fi.id);

create index if not exists idx_found_items_public_visible_created_at
on public.found_items (is_public_visible, created_at desc);

create or replace view public.v_found_items_public
with (security_invoker = true)
as
select *
from public.found_items
where is_public_visible = true;

grant select on public.v_found_items_public to anon, authenticated;

drop policy if exists found_items_select_public on public.found_items;

create policy found_items_select_public
on public.found_items
for select
to anon, authenticated
using (
  is_public_visible
  or created_by = auth.jwt() ->> 'sub'
  or exists (
    select 1
    from public.match_requests mr
    where mr.found_item_id = found_items.id
      and mr.claimant_user_id = auth.jwt() ->> 'sub'
  )
);
