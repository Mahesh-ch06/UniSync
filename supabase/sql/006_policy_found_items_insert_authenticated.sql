drop policy if exists found_items_insert_authenticated on public.found_items;

create policy found_items_insert_authenticated
on public.found_items
for insert
to authenticated
with check (created_by = auth.jwt() ->> 'sub');
