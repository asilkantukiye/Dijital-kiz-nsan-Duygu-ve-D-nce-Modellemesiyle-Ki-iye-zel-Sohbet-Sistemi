-- Production migration applied on 2026-10-08.
-- Optimizes auth.uid() evaluation in RLS policies and supports variant-scoped chat history.

drop policy if exists "users own twin profile" on public.twin_profiles;
create policy "users own twin profile"
  on public.twin_profiles
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "users own messages" on public.messages;
create policy "users own messages"
  on public.messages
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "users own feedback" on public.message_feedback;
create policy "users own feedback"
  on public.message_feedback
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create index if not exists messages_user_variant_created_idx
  on public.messages(user_id, variant, created_at desc);
