-- Authenticated users call match_memory_items with extensions.vector values.
-- Grant schema usage explicitly; this does not grant table access or bypass RLS.
grant usage on schema extensions to authenticated;
