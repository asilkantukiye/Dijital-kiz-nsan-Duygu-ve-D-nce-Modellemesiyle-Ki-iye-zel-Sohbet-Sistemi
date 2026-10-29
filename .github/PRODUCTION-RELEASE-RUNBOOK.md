# Production Integration Release Runbook

## Release gates

This runbook intentionally does not bypass existing security gates. A release is accepted only when CI passes, the published adapter has been verified in Hugging Face, the live Supabase schema guard is exactly **true**, Production variables are present, the staged health probes pass, and an authenticated chat request returns HTTP 200.

## GitHub Actions secrets and variables

Configure these under **Repository → Settings → Secrets and variables → Actions**. Never put values in source code, issue comments, command arguments, or chat.

| Name | Where | Required | Purpose |
| --- | --- | --- | --- |
| VERCEL_TOKEN | GitHub Actions secret | Yes | Least-privilege token for the Vercel team/project |
| HF_TOKEN | GitHub Actions secret and Vercel Production env | Yes | Hugging Face read/inference token used by the application and deep health probe |
| HF_WRITE_TOKEN | GitHub Actions secret only | For model publishing | Hugging Face write token scoped to the target model repository/namespace |
| HEALTHCHECK_TOKEN | GitHub Actions secret and Vercel Production env | Yes | Random secret, minimum 32 characters, used by /api/health/deep |
| RATE_LIMIT_KEY_SALT | Vercel Production env | Yes | Random secret, minimum 32 characters, used to derive rate-limit identity digests |
| SUPABASE_SERVICE_ROLE_KEY | Vercel Production env | Yes | Server-only Supabase key; never prefix with NEXT_PUBLIC_ |
| NEXT_PUBLIC_SUPABASE_URL | Vercel Production env | Yes | Supabase project URL |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Vercel Production env | Yes | Supabase public/publishable key |
| UPSTASH_REDIS_REST_URL | Vercel Production env | Required | Upstash REST URL; Production readiness blocks unless its token is also present |
| UPSTASH_REDIS_REST_TOKEN | Vercel Production env | Required | Upstash REST token; Production readiness blocks unless its URL is also present |
| PRODUCTION_SMOKE_TEST_EMAIL | GitHub Actions secret only | Yes for deploy workflow | Dedicated, confirmed, low-privilege Supabase test account email |
| PRODUCTION_SMOKE_TEST_PASSWORD | GitHub Actions secret only | Yes for deploy workflow | Password for the dedicated smoke-test account |
| SUPABASE_PRODUCTION_SCHEMA_VERIFIED | GitHub repository variable | Yes | Must be exactly true only after live migration/RLS/RPC checks pass |

The app needs HF_TOKEN; the publishing workflow separately needs HF_WRITE_TOKEN. A read/inference token is not a substitute for a write token. The HF_WRITE_TOKEN owner must have write permission to the selected OWNER/REPO. The verified existing target is the private repository hasankb00/dijital-ikiz-qwen3-4b-lora; the live check found only .gitattributes in it. The requested asilkantukiye/dijital-ikiz-qwen3-4b-lora repository was not found under that namespace. The publishing workflow defaults to the existing repo; use a different workflow input only when HF_WRITE_TOKEN has write permission to that destination.

## Configure secrets without exposing values

Run these from a trusted terminal after gh auth status and npx vercel whoami confirm the intended accounts/team. Each command securely reads its value from standard input. Do not use --body for secrets because it may expose the value in command history/process metadata.

    gh secret set VERCEL_TOKEN
    gh secret set HF_TOKEN
    gh secret set HF_WRITE_TOKEN
    gh secret set HEALTHCHECK_TOKEN
    gh secret set PRODUCTION_SMOKE_TEST_EMAIL
    gh secret set PRODUCTION_SMOKE_TEST_PASSWORD

HEALTHCHECK_TOKEN must be the same value in GitHub Actions and Vercel Production. Generate it locally with a cryptographically secure random generator and store the identical value in both places.

Add a repository variable only after verifying the live database:

    gh variable set SUPABASE_PRODUCTION_SCHEMA_VERIFIED --body true

Do not set the database guard just to make a workflow green. If the variable is already true, the live Supabase migrations, RLS, required RPC grants, and retention job must still match the intended Production project.

## Hugging Face model publication

1. Merge the reviewed PR that adds .github/workflows/publish-kaggle-lora.yml and ml/kaggle/publish_lora_to_hf.py.
2. From main, dispatch the workflow for the successful Kaggle run currently recorded as 40562948791:

    gh workflow run publish-kaggle-lora.yml --ref main -f run_id=40562948791 -f model_repo=hasankb00/dijital-ikiz-qwen3-4b-lora

3. Follow the exact run:

    $runId = gh run list --workflow publish-kaggle-lora.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId'
    gh run watch $runId --exit-status

The publishing step refuses invalid ZIP paths, missing adapter_config.json, missing adapter weights, missing tokenizer files, an unexpected base model, invalid metrics, a missing test-loss improvement, public visibility, and incomplete remote files. It publishes only the LoRA adapter, tokenizer, README, metrics, and SHA-256 manifest; it does not upload the larger sentiment model or any secrets. The workflow checks final remote file names and verifies the repository remains private.

After success, open the Hugging Face model repository and confirm it contains at least:

- adapter_config.json
- adapter_model.safetensors (or the expected PEFT .bin format)
- tokenizer_config.json and tokenizer vocabulary file
- training-metrics.json
- artifact-manifest.json
- README.md

A LoRA adapter is not a standalone Qwen model. The app's inference provider remains governed by HF_MODEL; publishing this adapter alone does not prove the app is loading it. Adapter serving/integration is a separate release decision and must be tested before claiming the web app uses the fine-tuned weights.

## Main-branch and Vercel release sequence

Use a clean working tree. Run the following from the repository root after the pull request is merged:

    git fetch origin --prune
    git switch main
    git pull --ff-only origin main
    git status --short
    git log -1 --format="%H%n%s"
    gh run list --workflow ci.yml --branch main --limit 5

Do not continue if git status --short shows uncommitted files, the last commit is not the intended release, or CI has not passed for that exact commit.

Set/verify environment names in Vercel without printing values:

    npx vercel@63.1.2 link --yes --project dijital-ikiz-insan --scope help-70c6
    npx vercel@63.1.2 env ls production --scope help-70c6

The required Production names are NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, HF_TOKEN, RATE_LIMIT_KEY_SALT, and HEALTHCHECK_TOKEN. UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are both required in Production and must be valid. If either is missing, the environment gate stops the build. If Redis returns an error or times out, `/api/chat` fails closed with HTTP 503 and `Retry-After`, while `/api/health/deep` reports 503. Production does not fall back to a process-local limiter or silently bypass rate limiting.

Launch only from the latest main ref (never from a feature or stale branch):

    gh workflow run "Vercel Deploy" --ref main
    $runId = gh run list --workflow "Vercel Deploy" --branch main --limit 1 --json databaseId --jq '.[0].databaseId'
    gh run watch $runId --exit-status

The deploy workflow stays manual on purpose. It validates, stages a Production build without assigning the public domain, checks /api/health, checks authenticated /api/health/deep, runs the authenticated /api/chat end-to-end smoke test, and only then enters the protected production environment promotion gate. It repeats smoke tests against https://dijital-ikiz-insan.vercel.app after promotion. A failed gate must stay failed; do not bypass a missing secret, a failed health check, or the Supabase schema guard.

## Expected production HTTP status matrix

| Request | Expected status | Meaning |
| --- | ---: | --- |
| GET /api/health | 200 and ok=true, ready=true | Liveness and minimum application configuration are present |
| GET /api/health/deep with correct x-healthcheck-token | 200, all provider flags true | Supabase Auth, Hugging Face token authentication and rate-limit backend probes pass; HF inference itself is tested by chat |
| GET /api/health/deep without token | 404 | Correct fail-closed behavior; no route configuration disclosure |
| POST /api/chat without a valid Supabase session | 401 | Correct auth boundary; an unauthenticated 200 is a security failure |
| POST /api/chat with valid test-user session, valid JSON and working providers | 200 with non-empty reply | Real end-to-end chat, inference and atomic message persistence passed |
| POST /api/chat with invalid payload | 400 or 413 | Request validation rejected it |
| POST /api/chat when rate-limit service is unavailable | 503 with Retry-After | Fail-closed temporary fallback; no unsafe bypass |
| POST /api/chat when Hugging Face is unavailable or times out | 502/503 | Provider failure is surfaced as a controlled error instead of a fake success |
| POST /api/chat when database write path is unavailable | 503 or 500 depending on the failing boundary | No claim of successful saved chat; inspect the sanitized code/log correlation |

Do not deliberately disable Production credentials to test 503 behavior. Exercise provider timeout/auth failures, invalid model responses, Supabase RPC failures, and rate-limit failures in unit/integration tests or a disposable Preview environment with isolated test data.

## Browser Network (F12) validation

1. Open the public site, sign in with a normal test account, press F12, open Network, enable Preserve log, and filter for chat.
2. Send one baseline and one personalized message separately. For each POST /api/chat, inspect Status, Request Payload, Response, and Timing. Success is HTTP 200 with a non-empty reply. Do not export HAR files or screenshots containing cookies, Authorization headers, request bodies, or personal chat text.
3. With a signed-out/private browser, a POST /api/chat should return 401. A valid message that returns 502/503 is a controlled provider/service failure, not a successful chat. Check Retry-After on 503 and make sure the UI presents a retryable message without revealing tokens, stack traces or internal database details.
4. A missing/invalid x-healthcheck-token on /api/health/deep should return 404. Never paste the health token into the browser URL or a screenshot. Run the authenticated deep check via the workflow or a secure terminal.
5. Confirm a response is persisted once; resend the same exact message/variant during the deduplication window and confirm it does not create duplicate pairs or invoke the model twice. Use a dedicated test account, not a personal conversation.

## 503 fallback verification matrix

| Injected test failure (Preview/unit test only) | Expected behavior |
| --- | --- |
| HF_TOKEN absent | Chat fails closed with a controlled 503; /api/health reports ready=false; no token value in response/log |
| Hugging Face returns 401/403 | Controlled provider-auth failure; no raw provider body/credentials in response |
| Hugging Face times out or returns 5xx | Controlled 502/503; bounded retry/timeout; Retry-After on 503 |
| Empty/malformed model output | Controlled error, no persistence of a fake assistant response |
| Supabase service-role/write RPC unavailable | Controlled failure; atomic write means no partial user/assistant pair is accepted as success |
| Rate-limit store unavailable | 503 / fail closed, never silently fall back to per-process memory |
| Wrong deep-health token | 404, no provider details returned |
| Missing or partial Upstash configuration | Production build gate fails; if Redis fails after deployment, chat fails closed with HTTP 503 and Retry-After |
| Duplicate simultaneous request | One owner does model work; concurrent duplicate receives replay/wait behavior or a controlled conflict, not two persisted turns |

## Release decision

**GO** only if CI for the exact main SHA passes, model artifact publication verifies all expected private Hub files, the live Supabase guard is verified, the Production env-name gate passes, both staged and public-domain smoke tests pass, and authenticated /api/chat produces HTTP 200 with a saved reply. Otherwise keep the release blocked and fix the failing gate.
