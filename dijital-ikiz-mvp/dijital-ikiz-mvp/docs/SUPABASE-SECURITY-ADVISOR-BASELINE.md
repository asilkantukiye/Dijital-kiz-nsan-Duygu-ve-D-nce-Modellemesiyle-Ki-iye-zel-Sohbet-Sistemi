# Supabase Security Advisor baseline

Last verified: 29 October 2026  
Project ref: \`yaryteseqvmyvapyppmy\`

This document records intentional security patterns so that an advisor warning is not silently ignored and is not “fixed” by breaking required authorization paths.

## Internal coordination tables: RLS enabled, no user-facing policies

The following tables are internal coordination state used by server-side rate limiting, request deduplication, and chat-data deletion serialization:

- \`public.chat_rate_limit_counters\`
- \`public.chat_request_deduplication\`
- \`public.chat_user_data_generations\`

Expected security properties:

- RLS remains enabled on all three tables.
- \`anon\` and \`authenticated\` have no direct SELECT, INSERT, UPDATE, or DELETE grants.
- \`service_role\` has the direct table privileges used by the server-side operations.
- User-facing access is through explicitly scoped application functions, not direct access to these tables.

Supabase's \`rls_enabled_no_policy\` INFO finding is therefore expected for these tables: no policies are needed when end users have no table privileges at all. Do not create broad policies to silence the finding.

Regression coverage: \`tests/sql/internal_security_boundary.integration.sql\`.

## Caller-scoped SECURITY DEFINER functions

The following functions intentionally allow the \`authenticated\` role to execute them because the application memory lifecycle invokes them using a verified Supabase user session:

- \`public.current_my_chat_data_generation()\`
- \`public.delete_my_chat_request_claims_for_current_user()\`
- \`public.persist_my_memory_at_generation(integer, text, text, real, extensions.vector, uuid)\`

The expected privilege matrix is:

| Role | Execute |
| --- | --- |
| \`anon\` | Denied |
| \`authenticated\` | Allowed, with ownership enforced inside each function |
| \`service_role\` | Denied for these user-scoped functions |

Function-level invariants:

- Each function derives identity with \`auth.uid()\`; callers cannot provide an arbitrary target \`user_id\`.
- The generation functions have no caller-supplied identity arguments.
- Memory persistence checks generation, value bounds, and that \`p_source_message_id\` belongs to the caller and is a user-message row.
- Chat-data deletion increments and removes only the caller's generation/claims.
- The functions pin \`search_path\` and validate inputs before writes.

The advisor's \`authenticated_security_definer_function_executable\` WARN finding is therefore a review signal, not by itself proof of an exploitable vulnerability. Do not revoke authenticated EXECUTE from these functions unless the implementation is first migrated to a different server-owned call path and end-to-end memory/deletion tests are updated.

Regression coverage: \`tests/sql/internal_security_boundary.integration.sql\`, plus the existing memory ownership, deletion, and chat integration tests.

## Remaining advisor findings

### Leaked password protection disabled

The live advisor reported that leaked-password protection is disabled. Supabase documentation says this setting is available on Pro plan and above: https://supabase.com/docs/guides/auth/password-security.

Treat this as a recorded residual risk until the project's current plan and Auth settings have been checked in the dashboard. Do not upgrade the project or create a paid dependency as part of an automated security fix. Keep a strong minimum password length and complexity setting if supported by the current plan, and revisit this finding when the setting is available.

### Unused indexes

The advisor reported \`messages_user_created_idx\`, \`memory_items_embedding_hnsw_idx\`, and \`memory_items_source_message_idx\` as unused during this inspection. The project is still in an early/low-traffic state, and the advisor snapshot reported zero rows for the listed user-data tables. An index may remain unused before representative traffic exists.

Do not delete these indexes solely to silence this INFO finding. Re-evaluate with representative production data, query plans, and measured write/read cost before changing the indexing strategy.

## Revalidation

Run after any migration touching these tables or functions:

1. \`tests/sql/internal_security_boundary.integration.sql\`
2. \`tests/sql/security_rpc.integration.sql\`
3. \`tests/sql/memory_preference_update.integration.sql\`
4. \`tests/sql/memory_source_ownership.integration.sql\`
5. \`tests/sql/data_deletion_idempotency.integration.sql\`
6. Supabase Security Advisor and Performance Advisor

A clean CI run proves the tested invariants hold in its isolated PostgreSQL fixture. It does not replace this live-project review.
