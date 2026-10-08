-- Stage 5 memory FK performance hardening
create index if not exists memory_items_source_message_idx
  on public.memory_items(source_message_id);