-- AUD-05 follow-up: validate historical rows after the NOT VALID constraint
-- has committed in the previous migration. Keep this scan in its own transaction
-- so the ADD CONSTRAINT DDL lock is not retained throughout validation.
ALTER TABLE public.memory_items
  VALIDATE CONSTRAINT memory_items_embedding_integrity_check;
