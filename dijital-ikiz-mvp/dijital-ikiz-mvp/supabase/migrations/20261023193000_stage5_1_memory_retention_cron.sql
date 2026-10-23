-- Stage 5.1: enforce the 180-day memory inactivity rule without waiting for chat.
-- Apply with the trusted migration role after verifying pg_cron is available.
-- This job deletes memory_items only; it does not delete chat messages or profiles.
create extension if not exists pg_cron;

-- Keep the scheduled delete index-backed and bounded. Each run deletes at most
-- 1,000 stale rows; a backlog is drained over subsequent 15-minute runs.
create index if not exists memory_items_retention_never_used_idx
  on public.memory_items (updated_at, id)
  where last_used_at is null;

create index if not exists memory_items_retention_used_idx
  on public.memory_items (updated_at, last_used_at, id)
  where last_used_at is not null;

do $$
declare
  v_job_id bigint;
  v_cap_job_id bigint;
begin
  -- Jobs belong to the role that scheduled them. Replace only this migration
  -- role's job with the same name; don't cancel jobs owned by another role.
  select jobid
    into v_job_id
    from cron.job
   where jobname = 'stage5-memory-retention-cleanup'
     and username = current_user
   limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'stage5-memory-retention-cleanup',
    '*/15 * * * *',
    $cleanup$
      with stale as (
        select id
          from public.memory_items
         where updated_at < now() - interval '180 days'
           and (last_used_at is null
                or last_used_at < now() - interval '180 days')
         order by updated_at asc, id asc
         limit 1000
      )
      delete from public.memory_items as memory
       using stale
       where memory.id = stale.id;
    $cleanup$
  );
  select jobid
    into v_cap_job_id
    from cron.job
   where jobname = 'stage5-memory-cap-cleanup'
     and username = current_user
   limit 1;

  if v_cap_job_id is not null then
    perform cron.unschedule(v_cap_job_id);
  end if;

  -- Existing inactive accounts may have accumulated more than 50 rows before
  -- the insert trigger was introduced. Drain that historical overflow daily.
  perform cron.schedule(
    'stage5-memory-cap-cleanup',
    '15 3 * * *',
    $cap_cleanup$
      with ranked as (
        select id,
               row_number() over (
                 partition by user_id
                 order by updated_at desc, id asc
               ) as row_number
          from public.memory_items
      ),
      overflow as (
        select id
          from ranked
         where row_number > 50
         order by id
         limit 1000
      )
      delete from public.memory_items as memory
       using overflow
       where memory.id = overflow.id;
    $cap_cleanup$
  );
end
$$;

comment on index public.memory_items_retention_never_used_idx is
  'Supports bounded pg_cron deletion of never-used memory older than the retention window.';
comment on index public.memory_items_retention_used_idx is
  'Supports bounded pg_cron deletion of memory with stale update and last-use timestamps.';
