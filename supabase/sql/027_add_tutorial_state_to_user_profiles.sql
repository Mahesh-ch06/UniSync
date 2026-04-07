-- Stores per-tutorial onboarding completion flags per user.
-- Example payload: {"home-onboarding-tour-seen-v1": true}

alter table public.user_profiles
  add column if not exists tutorial_state jsonb;

update public.user_profiles
set tutorial_state = '{}'::jsonb
where tutorial_state is null;

alter table public.user_profiles
  alter column tutorial_state set default '{}'::jsonb;

alter table public.user_profiles
  alter column tutorial_state set not null;
