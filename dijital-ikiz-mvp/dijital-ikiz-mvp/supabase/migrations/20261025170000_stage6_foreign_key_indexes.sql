-- Stage 6: add covering indexes for child-side foreign-key lookups.
-- These indexes do not change RLS, grants, or row contents. They reduce the
-- amount of work PostgreSQL must do when referenced messages are deleted or
-- foreign-key references are checked.
CREATE INDEX IF NOT EXISTS chat_request_deduplication_user_message_id_idx
  ON public.chat_request_deduplication (user_message_id);

CREATE INDEX IF NOT EXISTS chat_request_deduplication_assistant_message_id_idx
  ON public.chat_request_deduplication (assistant_message_id);

CREATE INDEX IF NOT EXISTS memory_items_source_message_owner_idx
  ON public.memory_items (source_message_id, user_id);
