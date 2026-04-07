# Supabase SQL

Run files in numeric order:

1. 001_enable_pgcrypto.sql
2. 002_create_found_items_table.sql
3. 003_create_found_items_created_at_index.sql
4. 004_enable_rls_found_items.sql
5. 005_policy_found_items_select_public.sql
6. 006_policy_found_items_insert_authenticated.sql
7. 007_seed_found_item.sql (optional)
8. 008_verify_found_items.sql (optional)
9. 009_home_campus_intelligence.sql
10. 010_verify_home_intelligence.sql (optional)
11. 011_create_loss_match_points_schema.sql
12. 012_enable_rls_loss_match_points.sql
13. 013_verify_loss_match_points.sql (optional)
14. 014_match_request_pickup_lifecycle.sql
15. 015_verify_match_request_pickup_history.sql (optional)
16. 016_match_request_messages.sql
17. 017_verify_match_request_messages.sql (optional)
18. 018_found_items_claim_visibility.sql
19. 019_verify_found_items_claim_visibility.sql (optional)
20. 020_create_user_profiles_and_summary.sql
21. 021_verify_user_profiles_and_summary.sql (optional)
22. 022_update_profile_summary_in_progress_and_last_activity.sql
23. 023_fix_user_profiles_rls_claim_mapping.sql
24. 024_user_profiles_rls_allow_clerk_session_role.sql
25. 025_fix_user_profile_settings_schema_compat.sql
26. 026_create_push_device_tokens.sql
27. 027_add_tutorial_state_to_user_profiles.sql
28. 028_create_user_notifications.sql
