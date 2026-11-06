# HomeOps Deployment Guide (Supabase → Worker → Telegram → Dashboard)

Order matters: each step produces values the next one needs. Keep a scratch note with these values:

| Value | Comes from | Used by |
|---|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API | Worker, Dashboard |
| `SUPABASE_ANON_KEY` | same page (`anon` `public`) | Dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` | same page (`service_role`, **secret**) | Worker only |
| `TELEGRAM_BOT_TOKEN` | @BotFather | Worker |
| `TELEGRAM_WEBHOOK_SECRET` | you generate | Worker + setWebhook |
| `INTERNAL_API_SECRET` | you generate | Worker |
| `WORKER_URL` | printed by `wrangler deploy` | setWebhook |

Generate secrets (A–Z, a–z, 0–9, `_`, `-` only for the Telegram one):
```powershell
# PowerShell 7 (Windows). Run once per secret.
[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```
```bash
# macOS / Linux / Git Bash
openssl rand -hex 32
```
Never put the service_role key in the dashboard or commit it.

## Prerequisites
- Node.js 18+ and npm
- Free accounts: Supabase, Cloudflare, Telegram
- This repo cloned, `npm install` run in `worker/` and `dashboard/`

---
## 1. Supabase (database)

### 1.1 Create the project
1. Sign in at https://supabase.com/dashboard → **New project**.
2. Fill in:
   - **Organization**: your org (the free plan is fine for the pilot).
   - **Name**: `homeops`.
   - **Database password**: click *Generate*, then save it in a password manager. You need it for the CLI and direct DB access.
   - **Region**: closest to your users (e.g. *South Asia (Mumbai)* for India).
3. Click **Create new project** and wait 1–2 minutes until the dashboard shows the project as healthy.
4. Note the **project ref**, the ID in the URL `supabase.com/dashboard/project/<ref>`. Your project URL is `https://<ref>.supabase.co`.

> Free-plan projects pause after 7 days without activity. The Worker's every-minute cron keeps it active once deployed.

### 1.2 Run the migrations: Option A, SQL Editor (no install)
Open **SQL Editor** in the left sidebar. For each file below, in this exact order:
1. Click **+ New query** (a fresh tab each time).
2. Open the file in VS Code, select all (`Ctrl+A`), copy, and paste into the editor.
3. Click **Run** (or `Ctrl+Enter`). Expect *"Success. No rows returned."*
4. If you get an error, **stop**: don't run the next file. See *Troubleshooting* below.

| # | File | What it creates |
|---|---|---|
| 1 | `supabase/migrations/00001_initial_schema.sql` | `uuid-ossp` extension, enums, 17 tables, indexes |
| 2 | `supabase/migrations/00002_row_level_security.sql` | RLS on tables, `is_operator()`, operator policies, `updated_at` triggers |
| 3 | `supabase/migrations/00003_atomic_assignment.sql` | Matching RPCs: `accept_service_request_offer`, `claim_expired_search_requests`, `finalize_batch_progression`, `update_technician_metrics` |
| 4 | `supabase/migrations/00004_security_hardening.sql` | RLS on remaining tables; restricts the RPCs to `service_role`; pins `search_path` |
| 5 | `supabase/migrations/00005_operator_dashboard_access.sql` | Lets logged-in operators read the request audit trail, addresses, attachments and their own operator row, and manage the service catalog |
| 6 | `supabase/migrations/00006_api_role_grants.sql` | Table privileges for `service_role` (Worker) and `authenticated` (dashboard). Without it: *permission denied for table …* |
| 7 | `supabase/migrations/00007_bot_sessions.sql` | `bot_sessions` table that stores the bot's multi-step conversation state |
| 8 | `supabase/migrations/00008_request_flow_fixes.sql` | Locality columns, fair-rotation counter function, batch progression that advances once all offers are answered, expiry check on offer acceptance |
| 9 | `supabase/migrations/00009_reviews_payments_config.sql` | Review tags, payment declaration, `marketplace_config` (dashboard-editable settings), scheduled-slot search, corrected technician metrics, daily maintenance function |
| 10 | `supabase/migrations/00010_admin_mfa_enforcement.sql` | `is_operator()` requires MFA (aal2) for ADMIN operators |
| 11 | `supabase/migrations/00011_review_reminders.sql` | `review_skips`: remembers "Skip this review" so the bot stops reminding |
| 12 | `supabase/migrations/00012_trust_and_cancellation.sql` | Start PIN, closure reason, automatic flags in the complaints queue, SLA/limit settings, ratings counted only for confirmed jobs |
| 13 | `supabase/migrations/00013_rematch_after_cancellation.sql` | Scheduler never searches before a booking's slot is near, so re-opened bookings wait for their slot instead of failing |
| 14 | `supabase/migrations/00014_safety.sql` | Chat transcripts (evidence), report categories and urgency, held ratings, warnings and account-action audit, private `verification-docs` bucket for technician IDs |
| 15 | `supabase/migrations/00015_verification_notifications.sql` | Remembers which application status each technician was told, so the bot can message them when an operator approves or rejects them |
| 16 | `supabase/seed.sql` | Service categories (Plumbing, Electrical, AC) and issue types |

Each file runs once only. Running it again fails with *"already exists"*. To start over, see *Reset* below.

### 1.2 Run the migrations: Option B, Supabase CLI (repeatable)
Run from the repo root (`D:\HomeOps`). This needs Node only, no Docker.
```powershell
npx supabase login                                     # opens browser, creates an access token
npx supabase init                                      # first time only; creates supabase/config.toml. Answer "N" to the VS Code / Deno prompts
npx supabase link --project-ref <your-project-ref>     # asks for the DB password from 1.1
npx supabase db push --remote --include-seed           # applies 00001..00005, then seed.sql to the linked cloud project
```
Don't drop `--remote`: without it, newer CLI versions target a local Docker database (`127.0.0.1:54322`) and fail with `ECONNREFUSED`. `db push` records applied migrations, so later you only add new files (e.g. `00005_*.sql`) and run `db push` again.

### 1.3 Verify the database
Run these in the SQL Editor:
```sql
-- a) 17 tables, all with RLS on (rowsecurity = true for every row)
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

-- b) Seed data loaded
SELECT (SELECT count(*) FROM service_categories) AS categories,
       (SELECT count(*) FROM issue_types)        AS issue_types;

-- c) Backend RPCs NOT callable by anon (expect false, false)
SELECT has_function_privilege('anon', 'accept_service_request_offer(uuid,uuid,uuid)', 'execute') AS anon_accept,
       has_function_privilege('anon', 'claim_expired_search_requests(int)', 'execute')           AS anon_claim;
```
Then open **Advisors → Security Advisor** and click *Rerun linter*. There should be no "RLS disabled" or "Function search_path mutable" errors.

### 1.4 Collect API keys
Go to **Project Settings → API Keys** (on older dashboards, **Project Settings → API**):
- **Project URL** `https://<ref>.supabase.co` → Worker `SUPABASE_URL` (in `wrangler.toml`) and Dashboard `VITE_SUPABASE_URL`.
- **`anon` / publishable key** → Dashboard `VITE_SUPABASE_ANON_KEY`. This key is public and safe in the browser because RLS protects the data.
- **`service_role` / secret key** → Worker secret `SUPABASE_SERVICE_ROLE_KEY` only. It has full read/write access to every table, bypassing RLS, so whoever holds it controls all customer data. Store it **only** with `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (deployed) or in `worker/.dev.vars` (local, git-ignored). Never put it in:
  - **the dashboard**: any `VITE_*` variable is compiled into public JavaScript that anyone can read in the browser;
  - **`wrangler.toml` `[vars]`**: stored in plain text, committed, and visible in the Cloudflare dashboard;
  - **git, logs, screenshots, or chat**: don't `console.log(env)` in the Worker.

**Prefer the new `sb_secret_…` key** over the legacy `service_role` JWT if your project offers it (Project Settings → API Keys → *Secret keys*). It works as a drop-in replacement with this codebase (supabase-js 2.118). You can also revoke it on its own if it leaks. Rotating a leaked legacy key means changing the project JWT secret, which also invalidates the `anon` key and logs out every operator. Likewise, `sb_publishable_…` replaces `anon`.

**If the key leaks:** create a new secret key, run `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` with it, confirm the bot still works, then delete the old key in Supabase. For a legacy key, use Project Settings → JWT Keys → rotate, then update both the Worker secret and the dashboard's `VITE_SUPABASE_ANON_KEY`.

### 1.5 Configure Auth for the operator dashboard
Supabase Auth is used **only** by staff logging into the dashboard (email + password). Customers and technicians never touch it: the bot identifies them by their Telegram user ID. These settings make sure only accounts you create can log in.

1. **Authentication → Sign In / Providers**. In *User Signups*, turn **off** *Allow new users to sign up*, then **Save changes**. Under *Auth Providers*, leave **Email** enabled; the dashboard logs in with it. You'll still be able to add users yourself in step 1.6.
2. **Authentication → URL Configuration → Site URL**: after you deploy the dashboard (step 5), set it to the dashboard address, e.g. `https://homeops-dashboard.pages.dev`, and **Save**. Supabase uses this address in links inside password-reset emails. Leave it as-is until the dashboard exists.

### 1.6 Create an operator account
1. **Authentication → Users → Add user → Create new user**. Enter email and a strong password, tick **Auto Confirm User**, then **Create user**.
2. Click the new user and copy its **User UID**.
3. In the SQL Editor, link it as an operator. Replace the name and UID:
```sql
WITH p AS (
  INSERT INTO profiles (telegram_user_id, role, full_name)
  VALUES (-1, 'OPERATOR', 'Your Name')      -- placeholder ID; use -2, -3 … for more operators
  RETURNING id
)
INSERT INTO operator_profiles (profile_id, supabase_auth_user_id, operator_role, active)
SELECT id, 'PASTE-USER-UID-HERE', 'OPERATOR', TRUE FROM p;
```
   `profiles.telegram_user_id` is required and unique. A negative placeholder keeps the staff record from clashing with your personal Telegram account when you test the bot as a customer or technician.
4. Verify the operator was created (expect one row with `active = true`):
```sql
SELECT o.supabase_auth_user_id, o.active, p.full_name
FROM operator_profiles o JOIN profiles p ON p.id = o.profile_id;
```
To disable an operator later: `UPDATE operator_profiles SET active = FALSE WHERE supabase_auth_user_id = '<uid>';`

### 1.7 Backups (recommended)
The free plan has no downloadable backups. Before major changes, export the database:
`npx supabase db dump --linked -f backup.sql` (CLI, after `link`), or upgrade to Pro for daily backups.

### Troubleshooting Supabase
| Error | Fix |
|---|---|
| `type "..." already exists` / `relation "..." already exists` | That file already ran. Skip it, or reset (below). |
| `relation "operator_profiles" does not exist` while running 00002+ | 00001 didn't run or failed. Run the files in order. |
| `function ... does not exist` while running 00004 | 00003 didn't run. Run it first. |
| `duplicate key` in seed.sql | Seed already applied. Safe to ignore. |
| `db push` asks to repair migration history | You previously ran files via the SQL Editor. Run `npx supabase migration repair --status applied 00001 00002 00003 00004`, then `db push` again. |

### Reset (pilot / non-production only: deletes all data)
```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
```
Then rerun 1.2 from file 1. Auth users are kept, so redo step 1.6's SQL.

---
## 2. Telegram bot

1. In Telegram, open **@BotFather** → `/newbot` → pick a name and a username ending in `bot`. Copy the **token**.
2. Recommended: `/setprivacy` → your bot → *Enable* (irrelevant for private chats, harmless). `/setcommands` is optional.
3. Generate the **webhook secret** now (see the command at the top of this guide) and save it. It's a password *you invent*, not something Telegram gives you. You'll use the same value twice: in step 3 (`wrangler secret put TELEGRAM_WEBHOOK_SECRET`) and in step 4 (`setWebhook ... secret_token=`).
4. Do **not** call `setWebhook` yet; the Worker URL doesn't exist until step 3.

---
## 3. Cloudflare Worker (backend)

```bash
cd worker
npm install
cp wrangler.example.toml wrangler.toml     # already git-ignored
```
Edit `wrangler.toml`: set `SUPABASE_URL` to your project URL. Leave secrets out of this file.

```bash
npx wrangler login                          # opens browser
npm run typecheck && npm test               # sanity check

npx wrangler secret put TELEGRAM_BOT_TOKEN          # paste BotFather token
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET     # paste generated secret
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # paste service_role key
npx wrangler secret put INTERNAL_API_SECRET         # paste generated secret
```
(The first `secret put` may offer to create the Worker; answer yes. Or run `npm run deploy` first, then add secrets.)

```bash
npm run deploy
```
Output includes `https://homeops-worker.<your-subdomain>.workers.dev` → this is `WORKER_URL`.

Verify:
```bash
curl https://homeops-worker.<sub>.workers.dev/health
# {"status":"healthy","service":"HomeOps Worker"}
```
Two cron triggers are registered on deploy: every minute (offer-batch progression and scheduled-slot searches), and daily at 21:30 UTC / 03:00 IST (retention clean-up, fair-rotation counters, technician metrics).

`[vars]` in `wrangler.toml` also holds `DASHBOARD_ORIGIN` (the only browser origin allowed to call `/api/operator/*`) and `SUPPORT_CHAT_ID`. To enable the bot's **Support** messages:
1. Create a Telegram group for operators and add the bot to it.
2. Run `npx wrangler tail` in `worker/` and send `/start` in the group (bots in privacy mode still receive commands). The log shows `ignored group chat -…` or `ignored supergroup chat -100…`; that negative number is the group ID. The bot never replies in groups.
3. Put the ID in `SUPPORT_CHAT_ID` in `wrangler.toml` and run `npm run deploy`. Confirm in Cloudflare dashboard → Workers → homeops-worker → Settings → Triggers.

For local dev use a `worker/.dev.vars` file (git-ignored) with the same four secret names instead of `wrangler.toml` values.

---
## 4. Connect Telegram to the Worker

Windows (PowerShell):
```powershell
$token  = "9041014978:AAEF4CeM4xCWadTx1YkUXNhGGdyfWz0EZxk"
$secret = "9FTyZMwJAUA6f8Y"
curl.exe -X POST "https://api.telegram.org/bot$token/setWebhook" `
  -d "url=https://homeops-worker.homeops-app.workers.dev/webhook" `
  -d "secret_token=$secret" `
  -d "drop_pending_updates=true"
```
macOS / Linux / Git Bash:
```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://homeops-worker.<sub>.workers.dev/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d "drop_pending_updates=true"
```
Expect `{"ok":true,"result":true,"description":"Webhook was set"}`.

Check:
```powershell
curl.exe "https://api.telegram.org/bot$token/getWebhookInfo"      # PowerShell
```
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"  # bash
```
`url` must be correct, `last_error_message` absent, `pending_update_count` near 0. The `secret_token` must equal the `TELEGRAM_WEBHOOK_SECRET` Worker secret exactly, otherwise the Worker returns 401.

---
## 5. Operator Dashboard (Cloudflare Workers static assets)

The dashboard deploys as a static-assets Worker configured by [`dashboard/wrangler.jsonc`](dashboard/wrangler.jsonc), which serves `dist/`. Its `"name"` must match the Worker name in Cloudflare (currently `homeops`).

> Without `wrangler.jsonc`, `wrangler deploy` tries to auto-configure the Vite project and fails with *"The version of Vite used in the project ("5.4.21") cannot be automatically configured"*. Keep the file committed.

Option A, Git integration (recommended): Cloudflare → **Workers & Pages → Create → Import a repository**, select the repo, then:
- Project / Worker name: `homeops` (must match `wrangler.jsonc`)
- Production branch: `main`
- Root directory (Path): `dashboard`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- **Build** variables (Settings → Build → *Variables and secrets*, **not** the runtime "Variables and Secrets" under Settings): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and optionally `VITE_WORKER_URL` (defaults to `https://homeops-worker.homeops-app.workers.dev`; used for operator assign/cancel). Vite bakes them into the JavaScript at build time, so after adding or changing them, trigger a new build (Deployments → *Retry build*, or push a commit).

Option B, deploy from your machine:
```powershell
cd D:\HomeOps\dashboard
$env:VITE_SUPABASE_URL      = "https://<ref>.supabase.co"
$env:VITE_SUPABASE_ANON_KEY = "<anon or sb_publishable_ key>"
npm run build
npx wrangler deploy
```
The dashboard URL is `https://homeops.<your-subdomain>.workers.dev`. In Supabase → **Authentication → URL Configuration**, set **Site URL** to it.

Open the dashboard URL and sign in with the operator account from step 1. A signed-in user who isn't in `operator_profiles` sees a "not an active operator" screen.

> If the login page says *"Failed to fetch"* or the requests go to `example.supabase.co`, the `VITE_*` build variables were missing at build time. Add them as **build** variables and rebuild.

---
## 6. End-to-end smoke test
1. **Run the Worker self-check.** It reports the Supabase key type, table access and Telegram's webhook status in one call, without printing any secret:
   ```powershell
   curl.exe -H "Authorization: Bearer <INTERNAL_API_SECRET>" https://homeops-worker.<sub>.workers.dev/internal/diagnostics
   ```
   Everything should read `ok:` / `N rows`. `webhook_url` should be your `/webhook` URL and `last_error_message` should be `null`. Anything marked `WRONG`, `ERROR` or `MISSING` is the problem to fix first.
2. Message your bot `/start` from Telegram. The bot should reply, and the user should appear on the dashboard's **Users** page.
3. From a second Telegram account, create a customer request. Confirm it appears under **Requests**, and that offers go out to approved, online technicians.
4. If something doesn't work, run `npx wrangler tail` in `worker/` while you send a message. Every update now logs a line (`Update N: message "/start" from user …`) plus any Supabase or Telegram error.

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| Bot silent, `getWebhookInfo` shows 401 | `secret_token` ≠ `TELEGRAM_WEBHOOK_SECRET` secret. Re-run `setWebhook`/`secret put`. |
| `getWebhookInfo` shows 500 | Check `wrangler tail` or `/internal/diagnostics`. Usually a wrong `SUPABASE_URL` or service_role key, or migrations not applied. |
| Diagnostics: `SUPABASE_SERVICE_ROLE_KEY: WRONG: JWT with role "anon"` (or `publishable`) | You stored the public key. Run `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` again with the **service_role** / `sb_secret_` key. |
| Dashboard page shows "Could not load data … permission denied" or the audit trail is empty | Migration `00005_operator_dashboard_access.sql` not applied. |
| Dashboard shows empty tables | User isn't in `operator_profiles` with `active = TRUE`, or the Pages env vars were set after build (rebuild). |
| Dashboard login fails | User not confirmed or wrong password (Auth → Users). |
| Batches never expire | Cron trigger missing; redeploy the Worker. |
| Rotating a secret | `wrangler secret put NAME` again (no redeploy needed); for the Telegram secret also re-run `setWebhook`. |
