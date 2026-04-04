create table if not exists public.match_request_messages (
  id bigint generated always as identity primary key,
  match_request_id uuid not null references public.match_requests(id) on delete cascade,
  sender_user_id text not null,
  message_text text not null,
  created_at timestamptz not null default now(),
  constraint match_request_messages_text_len check (char_length(trim(message_text)) between 1 and 1000)
);

create index if not exists idx_match_request_messages_request_created
  on public.match_request_messages (match_request_id, created_at asc);

create index if not exists idx_match_request_messages_sender
  on public.match_request_messages (sender_user_id, created_at desc);
