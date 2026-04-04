select
  id,
  match_request_id,
  sender_user_id,
  left(message_text, 80) as preview,
  created_at
from public.match_request_messages
order by created_at desc
limit 40;
