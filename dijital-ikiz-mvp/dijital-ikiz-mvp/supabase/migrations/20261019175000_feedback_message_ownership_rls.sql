-- Enforce message ownership and experiment-variant consistency for feedback
-- at the database layer, not only through app/api/feedback.
--
-- Older policy checked only message_feedback.user_id = auth.uid(), which could
-- permit a user to attach their feedback row to another user's known message id
-- through direct PostgREST access. Clean up any such legacy rows before policy
-- replacement so research exports cannot silently include invalid pairings.
delete from public.message_feedback as feedback
where not exists (
  select 1
  from public.messages as referenced_message
  where referenced_message.id = feedback.message_id
    and referenced_message.user_id = feedback.user_id
    and referenced_message.role = 'assistant'
    and referenced_message.variant = feedback.variant
);

drop policy if exists "users own feedback" on public.message_feedback;
create policy "users own feedback"
  on public.message_feedback
  for all
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.messages as referenced_message
      where referenced_message.id = message_feedback.message_id
        and referenced_message.user_id = (select auth.uid())
        and referenced_message.role = 'assistant'
        and referenced_message.variant = message_feedback.variant
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.messages as referenced_message
      where referenced_message.id = message_feedback.message_id
        and referenced_message.user_id = (select auth.uid())
        and referenced_message.role = 'assistant'
        and referenced_message.variant = message_feedback.variant
    )
  );
