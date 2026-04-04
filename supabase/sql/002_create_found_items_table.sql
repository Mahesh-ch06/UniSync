create table if not exists public.found_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'General',
  location text not null,
  image_url text,
  created_by text,
  created_at timestamptz not null default now()
);
