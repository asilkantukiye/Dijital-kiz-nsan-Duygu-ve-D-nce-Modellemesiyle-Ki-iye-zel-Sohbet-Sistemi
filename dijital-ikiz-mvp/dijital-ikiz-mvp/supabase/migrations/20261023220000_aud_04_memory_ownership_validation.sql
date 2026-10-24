-- AUD-04: bind every non-null memory source to a message owned by that same user.
-- The historic FK checked only messages(id), allowing memory_items.user_id and
-- source_message_id to form a cross-tenant pair. Clean such legacy poisoned rows
-- before adding the composite constraint, then make mismatches impossible at SQL level.
BEGIN;

LOCK TABLE public.messages IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.memory_items IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM public.memory_items AS memory
USING public.messages AS source
WHERE source.id = memory.source_message_id
  AND source.user_id IS DISTINCT FROM memory.user_id;

-- A composite FK target must have an exact unique key, even though id alone is
-- already a primary key. Keeping this explicit makes tenant binding auditable.
CREATE UNIQUE INDEX IF NOT EXISTS messages_id_user_id_uidx
  ON public.messages (id, user_id);

ALTER TABLE public.memory_items
  DROP CONSTRAINT IF EXISTS memory_items_source_message_id_fkey;

ALTER TABLE public.memory_items
  DROP CONSTRAINT IF EXISTS memory_items_source_message_owner_fkey;

-- PostgreSQL checks (source_message_id,user_id) against (messages.id,user_id).
-- When a source message is deleted, clear only source_message_id; preserve the
-- memory's owning user_id so it never becomes NULL or changes tenant.
ALTER TABLE public.memory_items
  ADD CONSTRAINT memory_items_source_message_owner_fkey
  FOREIGN KEY (source_message_id, user_id)
  REFERENCES public.messages (id, user_id)
  ON DELETE SET NULL (source_message_id);

COMMIT;
