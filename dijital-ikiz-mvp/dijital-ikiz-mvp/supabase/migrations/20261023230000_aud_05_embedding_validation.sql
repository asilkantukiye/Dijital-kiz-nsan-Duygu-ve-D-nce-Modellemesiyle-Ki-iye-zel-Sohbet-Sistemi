-- AUD-05: enforce embedding integrity inside PostgreSQL as defense in depth.
-- vector(384) enforces dimensionality; this constraint rejects zero and non-finite norms.
-- NOT VALID avoids taking a long validation lock while adding the constraint, then the
-- separate validation step checks historical rows before the migration commits.
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

ALTER TABLE public.memory_items
  VALIDATE CONSTRAINT memory_items_embedding_integrity_check;

COMMIT;
