-- Drop the creation-time retention index: the policy uses inactivity timestamps.
DROP INDEX IF EXISTS public.memory_items_retention_created_at_idx;
CREATE INDEX IF NOT EXISTS memory_items_retention_updated_at_idx
  ON public.memory_items (updated_at);
