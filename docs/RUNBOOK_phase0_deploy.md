# Phase 0 Deploy Runbook

Manual one-time setup steps to get CI/CD wired between GitHub → Fly.io → Supabase.

## Status

| Item                                    | Status                                           |
| --------------------------------------- | ------------------------------------------------ |
| GitHub repo created                     | ✅ `genesis5990/chainsight`                      |
| Supabase project provisioned            | ✅ `chainsight-dev` (`uyiabyyovwhciitlzkal`)     |
| Supabase migrations applied             | ✅ 3 migrations, zero security advisories        |
| Fly apps created                        | ✅ chainsight-{api,web,worker,math}-dev          |
| Fly secrets staged                      | ✅ Supabase URL + anon key set on api + web apps |
| GitHub Actions deploy workflow          | ✅ `.github/workflows/deploy.yml`                |
| **FLY_API_TOKEN GitHub secret**         | ⏳ **You do this** (1 minute)                    |
| **SUPABASE_ACCESS_TOKEN GitHub secret** | ⏳ **You do this** (1 minute)                    |
| First deploy                            | Triggers automatically once secrets are set      |

## Step 1 — Generate Fly deploy token (1 minute)

Why: GitHub Actions needs a token to deploy to Fly. The token created during your session can't create scoped sub-tokens, so we generate a deploy-scoped token in the dashboard.

1. Open https://fly.io/dashboard/personal/tokens
2. Click **Create deploy token**
3. Name: `chainsight-github-actions`
4. Expiration: 1 year
5. Click **Create**
6. Copy the token (starts with `FlyV1 `)
7. Add as GitHub secret:

   ```bash
   gh secret set FLY_API_TOKEN -R genesis5990/chainsight
   # Paste the token when prompted
   ```

   Or via the GitHub web UI:
   - https://github.com/genesis5990/chainsight/settings/secrets/actions
   - New repository secret → Name: `FLY_API_TOKEN` → Value: paste token

## Step 2 — Generate Supabase access token (1 minute)

Why: CI runs `supabase` CLI commands (preview branches, migrations) which need a personal access token.

1. Open https://supabase.com/dashboard/account/tokens
2. Click **Generate new token**
3. Name: `chainsight-github-actions`
4. Click **Generate**
5. Copy the token (starts with `sbp_`)
6. Add as GitHub secret:
   ```bash
   gh secret set SUPABASE_ACCESS_TOKEN -R genesis5990/chainsight
   # Paste the token when prompted
   ```

## Step 3 — Trigger first deploy

Once both secrets are set, the next push to `main` deploys automatically. To trigger manually right now:

```bash
gh workflow run deploy.yml -R genesis5990/chainsight
gh run watch -R genesis5990/chainsight
```

Or push an empty commit:

```bash
git commit --allow-empty -m "chore: trigger first deploy"
git push
```

## Step 4 — Verify deployed services

Expected URLs (will be live after the first successful deploy):

| Service | URL                                 | Health check                                       |
| ------- | ----------------------------------- | -------------------------------------------------- |
| API     | https://chainsight-api-dev.fly.dev  | `/v1/health/live`                                  |
| Web     | https://chainsight-web-dev.fly.dev  | `/` (the landing page)                             |
| Math    | https://chainsight-math-dev.fly.dev | `/health`                                          |
| Worker  | (no public URL)                     | check logs: `flyctl logs -a chainsight-worker-dev` |

Smoke test from anywhere:

```bash
curl https://chainsight-api-dev.fly.dev/v1/health/live
curl https://chainsight-math-dev.fly.dev/health
open https://chainsight-web-dev.fly.dev
```

## Step 5 — When deploys fail (troubleshooting)

**Build failures:**

- Check `Dockerfile` paths are correct
- Confirm `pnpm-lock.yaml` exists in repo root (run `pnpm install` locally and commit)
- Check Fly remote builder logs in the Actions job

**Runtime failures:**

- `flyctl logs -a chainsight-{service}-dev` to see app logs
- `flyctl status -a chainsight-{service}-dev` to see machine state
- `flyctl secrets list -a chainsight-{service}-dev` to confirm secrets are set

**Auth failures from the deploy:**

- Confirm `FLY_API_TOKEN` is set and not expired
- Confirm the token has access to the personal org

## Cost monitoring

Both Fly and Supabase will charge for resources used. Expected Phase 0 baseline:

| Resource                                        | Cost                                |
| ----------------------------------------------- | ----------------------------------- |
| Supabase chainsight-dev project                 | $10/month (Pro org, second project) |
| Fly chainsight-api-dev (scale-to-zero)          | $0–5/month                          |
| Fly chainsight-web-dev (scale-to-zero)          | $0–5/month                          |
| Fly chainsight-worker-dev (1 machine always-on) | ~$3/month                           |
| Fly chainsight-math-dev (scale-to-zero)         | $0–5/month                          |
| **Total Phase 0**                               | **~$13–28/month**                   |

Scale-to-zero means the API/web/math apps only consume resources when there's traffic. The worker stays running because it polls the BullMQ queue.

## When you're done with this runbook

Move on to UI mockups (next session). The scaffold is ready to grow into the real product.
