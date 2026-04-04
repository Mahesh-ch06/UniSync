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
