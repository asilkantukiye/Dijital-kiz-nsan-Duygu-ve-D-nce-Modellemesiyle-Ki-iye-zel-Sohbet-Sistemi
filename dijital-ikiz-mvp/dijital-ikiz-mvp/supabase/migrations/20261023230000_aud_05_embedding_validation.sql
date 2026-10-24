-- AUD-05: enforce embedding integrity inside PostgreSQL as defense in depth.
-- vector(384) enforces dimensionality; this constraint rejects zero and non-finite norms.
-- NOT VALID checks new/changed rows immediately while deferring the historical scan
-- to a follow-up migration, after this transaction has released its DDL lock.
BEGIN;

ALTER TABLE public.memory_items
  DROP CONSTRAINT IF EXISTS memory_items_embedding_integrity_check;

ALTER TABLE public.memory_items
  ADD CONSTRAINT memory_items_embedding_integrity_check
  CHECK (
    extensions.vector_dims(embedding) = 384
    AND extensions.vector_norm(embedding) > 0
    AND extensions.vector_norm(embedding) < 'Infinity'::real
  ) NOT VALID;

COMMIT;
