# Adversarial Red-Team Audit — 2026-10-26

## Executive verdict

This audit covers the Next.js chat route, profile heuristic, memory/embedding pipeline, PostgreSQL migrations, RLS policies and RPC grants in this repository, plus read-only checks of the connected Supabase project.

**Verdict:** the code has useful, testable invariants, but “absolute fault tolerance”, “foolproof under every privilege escalation”, and “deadlock-free under every possible workload” are not defensible unconditional claims. The service-role key, database owner/superuser, JWT signing secret and remote model endpoint are trust boundaries. The patches in PR #111 harden application-owned paths, add storage constraints and targeted recovery tests, and do not modify the live Supabase database or production deployment.

Evidence:
- Source files inspected include lib/twin.ts, lib/memory.ts, lib/embedding-validation.ts, lib/huggingface.ts, app/api/chat/route.ts, app/api/data/route.ts, app/api/feedback/route.ts, and AUD-01 through AUD-07 migrations.
- The live Supabase project was queried read-only: PostgreSQL 17.11, pgvector 0.8.2; at audit time the memory_items table had zero rows.
- Read-only checks confirmed RLS on the five required tables, validated memory-source ownership FK, validated nonzero/finite embedding constraint, the 10-second replay trigger, expected critical RPC execution grants, and authenticated USAGE on the extensions schema.
- The live project lacks three Stage-6 child-side FK indexes. Its migration-history version IDs do not all match the checked-in filenames. No live migration, migration repair, or production promotion was performed.
- An earlier CI run (#517) passed for the preceding branch revision. Initial AUD-07 CI attempts exposed a missing SELECT privilege needed by a delete predicate and an invalid test expression using unsupported vector subscripting. The grant and test were corrected; acceptance depends on the latest CI run for the current head.

## 1. VAD / Big Five state machine and numerical stability

### State equation and interval

The application stores all 13 heuristic profile coordinates in [0,1], not [-1,1]. Valence, arousal and dominance are represented in the same interval. For a coordinate j, the implemented smoother has the form

\[
x_{t+1,j}=(1-\alpha)x_{t,j}+\alpha u_{t,j},\quad \alpha=0.25
\]

where x is the normalized previous state and u is the bounded feature for the latest message. The patch clamps the computed result before returning it, instead of relying only on the real-arithmetic property of the smoother.

The exact scalar clamp is

\[
C(z)=
\begin{cases}
0.5 & \text{if } z \text{ is not finite},\\
\min(1,\max(0,z)) & \text{otherwise}.
\end{cases}
\]

For a missing or non-finite prior coordinate, normalization first substitutes its configured baseline value \(b_j\); a finite numeric prior becomes \(C(p_j)\). The current-message feature is also passed through \(C\), and then the result is

\[
x_{t+1,j}=C\left((1-0.25)C(p_{t,j})+0.25C(u_{t,j})\right).
\]

Thus the returned coordinate is bounded even if a future feature accidentally returns a NaN or an out-of-range value. The baseline vector is configured centrally; missing profile objects use the baseline as a whole.

### Boundedness proof

Suppose x and u are in [0,1] and alpha is in [0,1]. The update is a convex combination: both weights are non-negative and sum to one. Therefore

\[
0\le(1-\alpha)x+\alpha u\le(1-\alpha)\cdot1+\alpha\cdot1=1.
\]

Given a bounded initial state, induction proves every exact-arithmetic state remains in [0,1]. Input normalization, finite-value checks and an explicit post-update clamp preserve that postcondition in the returned JavaScript result. Since every operand is bounded, this calculation cannot create an exploding magnitude. There is no gradient-descent step in lib/twin.ts, so “gradient explosion” does not apply to this heuristic transition; the separate ML training notebook is a different subsystem.

### Convergence versus stagnation

For constant target u, let e_t = x_t - u. Then

\[
e_{t+1}=(1-\alpha)e_t=0.75e_t
\quad\Longrightarrow\quad
e_t=0.75^t e_0.
\]

Thus the exact recurrence converges geometrically to a fixed target. The old-state contribution is approximately 7.52×10^-4 after 25 updates and 3.21×10^-13 after 100 updates. In floating-point arithmetic, rounding eventually produces a representable-number floor; convergence should not be described as infinitely many distinct floating-point values.

For arbitrary adversarial input, convergence to a single state is not guaranteed. If scalar observations alternate between 0 and 1, the stable two-cycle values are 3/7 and 4/7. The state remains bounded while oscillating. Boundedness and convergence are distinct guarantees.

### Scientific limitation

The feature maps in lib/twin.ts are hand-written heuristics, not calibrated psychological estimates. Boundedness proves numerical stability of the update, not validity of VAD or Big Five inference and not a faithful simulation of a person. The repository appropriately labels these outputs experimental and uncalibrated. The project’s 75% accuracy target is not a measured result until each task has a suitable held-out dataset and defined evaluation metric.

### Patch/test

The profile update now post-clamps the smoothed value. The tests add a 100,000-turn stress loop that asserts finite values in [0,1], plus a fixed-input convergence check. These tests support—but do not replace—the mathematical invariant.

## 2. PostgreSQL concurrency, idempotency and deadlocks

### Existing transaction model

The idempotency key is the pair (user_id, request_hash). The claim RPC distinguishes claimed, in_progress and replay states. The processing lease is five minutes; a completed response is replayed for ten seconds. Final persistence validates the owner token under row lock and writes the canonical profile, user message, assistant message and cached response in a single transaction. A raised exception rolls back the transaction.

The database’s default isolation is normally READ COMMITTED unless overridden; the repository does not establish SERIALIZABLE isolation globally. Correctness therefore depends on explicit unique constraints, conditional UPSERTs, row locks and current-row validation, not on a claim that every transaction runs serializably.

### Idempotency and duplicate calls

For the same user, variant and exact sanitized message, the primary key on (user_id, request_hash), atomic conflict handling and owner-token fencing prevent two workers from committing the same turn under the same active claim. The 10-second TTL is intentionally a response-replay window, not permanent deduplication. A later repeat after expiry can be a new chat turn. If an inference outlives its five-minute lease, a retry may start another external inference; the old owner cannot commit after ownership changes, but the external provider may still have spent compute.

### Lock discipline patch

AUD-07 introduces a transaction-scoped advisory lock derived from the user UUID, shared by server-side claim, release, final persistence and data deletion. The lock is held only within each short database transaction, never during Qwen network inference. The application-owned lock order is:

1. acquire the per-user advisory transaction lock;
2. lock/mutate the relevant idempotency row;
3. for completion, merge the profile and insert the message pair;
4. commit, releasing locks.

Hash collisions in the advisory-lock key can over-serialize unrelated users, but affect performance rather than tenant ownership or correctness. Expired-row cleanup uses a bounded, stably ordered SELECT FOR UPDATE SKIP LOCKED batch instead of locking arbitrary physical tuple IDs and waiting on rows owned by other transactions.

This is a proof for the audited server-owned paths, not a theorem that arbitrary future SQL outside the same lock discipline cannot deadlock. Any new transaction that touches these tables must preserve the ordering.

### Rate limiting and high-frequency requests

The chat route previously claimed an idempotency row before enforcing the distributed rate limit. That allowed duplicate floods to consume claim/poll database capacity before reaching the limiter. The order is now authenticated identity → bounded payload validation → rate limit → idempotency claim → inference → atomic persistence. Production fails closed when distributed rate-limit configuration is absent or its backend is unavailable.

The implemented quotas include per-user and global limits. They are not IP-based Sybil prevention: someone able to create many valid identities may distribute requests across identities until the global limit is reached. A trusted proxy/IP reputation control remains a possible additional defense, not an implemented guarantee.

### Delete-vs-inference race

The former deletion path removed messages, profile and memories but did not invalidate in-flight idempotency claims. A request could claim, spend time in model inference, race with deletion, and later recreate state. AUD-07 adds a server-only deletion RPC. After the route verifies auth.getUser(), it passes only the verified user.id. The RPC takes the same per-user lock, deletes the user’s idempotency claims first, then memories/profile/messages.

The operations are linearized: if persistence owns the lock first, it commits and deletion then removes those rows; if deletion owns the lock first, it removes the claim and a delayed worker later fails to find the claim. The SQL recovery test claims a turn, deletes that user’s data, attempts a late completion and asserts the delayed writer cannot recreate the turn. A 24-connection stress test asserts exactly one claimed result and 23 in_progress results for concurrent identical claims.

## 3. pgvector integrity and spatial correctness

### Metric and index

The memory table stores 384-dimensional vectors. Retrieval uses the cosine-distance operator <=> with an HNSW index using vector_cosine_ops. Similarity is computed as 1 - cosine distance. For unit vectors, cosine similarity equals the dot product, and squared Euclidean distance is 2 - 2 times the dot product; therefore those rankings are monotonic for unit vectors. The current query is explicitly cosine-based.

The current similarity threshold is an engineering parameter, not a validated psychological boundary. HNSW also makes a recall/latency tradeoff; no index can prove perfect approximate-nearest-neighbor recall at all corpus sizes.

### Storage-level protections

Application validation rejects incorrect dimensions, non-numeric values, NaN, infinities, zero vectors and non-finite norms, and returns a normalized vector. But client checks alone do not protect alternate write paths. AUD-07 adds a PostgreSQL BEFORE INSERT and BEFORE UPDATE OF embedding trigger that:
- verifies 384 dimensions;
- requires a finite strictly positive norm;
- applies extensions.l2_normalize;
- verifies the stored norm is within 0.001 of one.

A validated CHECK constraint independently enforces unit norm. vector(384) enforces the dimension typmod, and the existing integrity check rejects zero/non-finite norms. The trigger executes on embedding writes only, before HNSW index maintenance. It adds O(d), d=384 work to writes, not a trigger call on the read/query path.

The SQL test inserts a raw non-unit [3,4,0,…] embedding and verifies its database-stored vector has norm 1 and L2 distance near zero from [0.6,0.8,0,…], using supported pgvector operators rather than array subscripts. Another SQL test proves a zero vector is rejected. The live project had no memory rows at audit time, so production index degradation or backfill performance cannot be inferred.

## 4. Zero-trust identity, RLS and cross-tenant memory poisoning

### API trust boundary

The chat route verifies the cookie-backed Supabase session with auth.getUser() before request processing. The payload validator rejects client-provided user_id/userId and session_id/sessionId fields. The owner ID comes from the verified server-side user object. session_id is not an authority-bearing value in this route.

User-scoped Supabase calls handle identity-sensitive reads. The service-role client is imported through a server-only module and used only for specified trusted persistence/deletion RPCs. The service key is not exposed through a NEXT_PUBLIC_ environment variable. A valid stolen session token can still act as its owner until revoked/expired; RLS is not a substitute for session revocation or signing-key security.

### Database relationship guarantees

The normal memory_items RLS policy applies both USING and WITH CHECK predicates requiring auth.uid() = user_id. AUD-04 binds the memory owner and source-message ID. AUD-07 strengthens the key to (source_message_id, user_id, source_message_role) referencing (messages.id, messages.user_id, messages.role), while a CHECK requires source_message_role = 'user'. The referenced composite unique index makes PostgreSQL enforce owner and role for both INSERT and UPDATE regardless of application-level validation. If a source message is deleted, only source_message_id becomes NULL, preserving memory ownership.

The match_memory_items RPC is SECURITY INVOKER, filters by auth.uid(), and remains subject to RLS. Feedback is constrained by both route-level checks and a database policy requiring same owner, assistant role and matching variant. Direct authenticated INSERT/UPDATE on messages and twin_profiles is revoked. The idempotency table has RLS enabled but no anon/authenticated policy or grants; its server-only, fail-closed configuration should not be “fixed” by granting browser access.

### Definitive row policies

The effective policies for ordinary authenticated clients are equivalent to the following. They must be paired with table grants and the composite FK, not treated as a substitute for either.

~~~sql
ALTER TABLE public.memory_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own memory items" ON public.memory_items;
CREATE POLICY "users own memory items"
  ON public.memory_items
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER TABLE public.twin_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own twin profile" ON public.twin_profiles;
CREATE POLICY "users own twin profile"
  ON public.twin_profiles
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own messages" ON public.messages;
CREATE POLICY "users own messages"
  ON public.messages
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users own feedback" ON public.message_feedback;
CREATE POLICY "users own feedback"
  ON public.message_feedback
  FOR ALL TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.messages AS m
      WHERE m.id = message_feedback.message_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = 'assistant'
        AND m.variant = message_feedback.variant
    )
  )
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND EXISTS (
      SELECT 1 FROM public.messages AS m
      WHERE m.id = message_feedback.message_id
        AND m.user_id = (SELECT auth.uid())
        AND m.role = 'assistant'
        AND m.variant = message_feedback.variant
    )
  );

ALTER TABLE public.chat_request_deduplication ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.chat_request_deduplication FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.chat_request_deduplication TO service_role;
-- Intentionally create no anon/authenticated policy on this server-only table.
~~~

The memory policy prevents one authenticated owner from selecting or changing another owner's rows. The composite source FK independently prevents an owner from referencing another tenant's message—even when a table owner/test intentionally bypasses RLS—and the AUD-07 third key component further requires the source role to be user. The chat-write boundary additionally revokes direct authenticated INSERT/UPDATE on messages and twin_profiles; therefore the broad owner policies above do not restore those table grants.

### Definitive limit

RLS cannot protect data after compromise of the service-role key, database owner/superuser or JWT signing secret. Those identities are privileged trust roots and can bypass or alter policy/constraints. The stated guarantees are for normal authenticated/browser roles with the privileged credentials kept secret—not for a compromised database administrator.

## 5. Qwen failure, atomic writes and recovery

### Current request path

The model call is buffered (stream=false), not streamed to the browser or database as partial tokens. The provider wrapper enforces a timeout, bounded retries and validates the final non-empty reply. Chat persistence starts only after that complete reply exists. Therefore a model timeout or malformed response before persistence does not insert a message pair, profile observation or new memory row.

The chat-turn RPC is atomic for the profile update, user message, assistant message and replay cache. The memory retrieval operation has been made read-only before inference; recency updates and pruning run only after a completed main chat transaction. Memory extraction remains best effort after the successful response so an auxiliary embedding error does not turn an already-saved answer into a failure.

### What cannot be guaranteed

A network timeout cannot prove whether the remote provider performed no work, completed work but lost its response, or continues processing after abort. The provider wrapper can retry in that ambiguity. The accurate guarantee is at-most-one committed database completion for a fenced active claim—not exactly one external inference billing event.

If the process dies before it can release a claim, the claim remains processing until reclaimable; owner-token fencing prevents a stale worker from committing after another owner takes over. If the database commit succeeds but the HTTP reply is lost, a retry within ten seconds can replay the cached response. After the replay TTL, a new turn is allowed by design.

Memory extraction is outside the main chat transaction. If extraction writes some valid candidate memories and then a later candidate fails, a subset may remain; they are still owner-scoped and source-anchored, not orphan rows. All-candidate atomic extraction would require a separate validated bulk RPC and is not claimed by this patch.

## 6. Changes and acceptance criteria

This PR adds:
1. explicit post-clamp of the EMA state and adversarial long-run/convergence tests;
2. rate limiting before idempotency claims;
3. read-only pre-inference memory retrieval, with recency/pruning deferred until the main turn commits;
4. AUD-07 storage migration: same-user user-role memory FK, storage-normalized vectors, unit-norm CHECK, per-user transaction locks, SKIP LOCKED claim cleanup and server-only deletion that invalidates claims;
5. the data-delete API passing the verified session user to a service-only RPC;
6. SQL/CI tests for concurrent duplicate claims, raw embedding normalization, assistant-message anchoring rejection and deletion-vs-late-persistence;
7. a clean-schema baseline and migration runbook consistent with AUD-07.

Acceptance requires the **latest CI for PR #111** to pass SQL migrations, database integration tests, the concurrent claim test, unit tests, typecheck and production build. An older green revision is not evidence that later source changes passed. The live migration history must be reconciled against actual SQL effects before any production migration is applied; take/verify a backup and rollback plan first. Re-run live advisors after the approved Stage-6 indexes are applied. Do not drop “unused” indexes merely because the current project is quiet. Real training metrics and any 75% accuracy claim require task-specific data and independent evaluation; they are not proven by CI or this code audit.
