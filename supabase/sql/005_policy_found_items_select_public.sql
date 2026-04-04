drop policy if exists found_items_select_public on public.found_items;

create policy found_items_select_public
on public.found_items
for select
to anon, authenticated
using (true);
