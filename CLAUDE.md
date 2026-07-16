# CLAUDE.md

Guidance for working in this repository.

## Overview

`cad-alerts` is a full-stack Cloudflare Workers app. A **Vue 3 + Vite** SPA
frontend and a **Hono** backend are deployed together as a single Worker. It
ingests fire-department CAD "pre-alert" emails, uses OpenAI (via Cloudflare AI
Gateway) to generate a spoken alert and TTS audio, and serves recent alerts per
organization through an authenticated API.

## Architecture

- **Frontend** (`src/`): Vue 3 SPA — Vue Router (`src/router/`), Pinia store
  (`src/stores/settings.ts`), views in `src/views/`, components in
  `src/components/`. Talks to the backend via `src/api/client.ts`. `@` aliases to
  `src/`.
- **Backend Worker** (`server/`): entry `server/index.ts` exports `fetch`
  (Hono app) and `email` (email handler). Built with `@cloudflare/vite-plugin`.
  - `server/api.ts` — Hono REST API under `/api/`. Org auth via a Bearer
    `access_key` shared secret (`requireOrgAuth`, constant-time compared).
  - `server/index.ts` — `AlertWorkflow` (Cloudflare Workflow): parse email →
    generate text (OpenAI) → TTS → upload to R2 → insert alert row. Triggered by
    the `email` handler when a message subject contains "pre-alert".
  - `server/parse.ts` — parses the pipe-delimited CAD email body.
  - `server/prompts.ts` — OpenAI prompt/instruction strings.
- **Shared** (`shared/types.ts`): API contract types shared by frontend and
  backend. `server/schema.ts` has a compile-time guard asserting Drizzle row
  types stay assignable to these — keep them in lockstep.

## Cloudflare bindings (`wrangler.jsonc`)

- `db` — D1 database `cad-alerts` (SQLite).
- `bucket` — R2 bucket `cad-tts` (generated audio).
- `ai` — Workers AI / AI Gateway (`sar` gateway) for OpenAI calls.
- `ai_key` — Secrets Store secret (`sar_openai_default`), the OpenAI API key.
- `alert_workflow` — the `AlertWorkflow` Workflow.
- Runtime secret `AI_GATEWAY_TOKEN` — set as a Worker secret (see `example.env`
  for the local `.dev.vars` shape); not in source.

## Commands

- `npm run dev` — local dev server (Vite + Worker).
- `npm run type-check` — `vue-tsc --build` across the TS project references.
- `npm test` — Vitest (`vitest run`); `npm run test:watch` to watch.
- `npm run build` — type-check + `vite build`. `npm run build-only` skips the
  type-check (used in CI where type-check runs as its own step).
- `npm run deploy` — build then `wrangler deploy` (manual deploy).
- `npm run cf-typegen` — regenerate `worker-configuration.d.ts` from bindings
  (commit the result).

## Tests

Vitest, Node environment (`vitest.config.ts`). Test files live next to source as
`*.test.ts` under `server/` and `src/` (e.g. `server/parse.test.ts`,
`src/api/client.test.ts`). Tests need no secrets. Run `npm test` before
committing.

## CI/CD (GitHub Actions)

- `.github/workflows/ci.yml` — on PRs to `main`: `npm ci` → type-check → test →
  `build-only`.
- `.github/workflows/deploy.yml` — on push to `main`: type-check → test → build →
  **apply D1 migrations** → `wrangler deploy`.
- Deploy requires repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
  (GitHub → Settings → Secrets and variables → Actions). PR CI needs no secrets.

## Database schema & migration strategy

**The database schema is managed with `wrangler d1 migrations`.** Migration files
live in `migrations/` (declared via `migrations_dir` on the `db` binding in
`wrangler.jsonc`) as numbered SQL files; wrangler tracks applied migrations in a
`d1_migrations` table. The deploy workflow runs
`wrangler d1 migrations apply cad-alerts --remote` **before** `wrangler deploy`,
so schema changes ship automatically with the code on every push to `main`.

`server/schema.ts` (Drizzle table definitions) is the runtime source of truth for
row types; migrations must be kept consistent with it (the compile-time guard in
`schema.ts` ties row types to `shared/types.ts`).

### Changing the schema

1. Edit `server/schema.ts` to reflect the new shape.
2. Create a migration:
   `npx wrangler d1 migrations create cad-alerts <description>` — this generates
   the next `migrations/000N_<description>.sql`.
3. Write the **incremental, forward** SQL (e.g. `ALTER TABLE ...`,
   `CREATE INDEX IF NOT EXISTS ...`). Do **not** put `DROP TABLE`/destructive
   resets in migrations — the production DB holds live data.
4. Test locally: `npm run db:migrate:local` (applies to the local D1 in
   `.wrangler/`); `npx wrangler d1 migrations list cad-alerts --local` should then
   show nothing pending.
5. Update any affected code/tests, run `npm test` and `npm run type-check`.
6. Merge to `main` — the deploy workflow applies the migration to production.

### Conventions & gotchas

- Migrations run in numeric order by filename prefix; never renumber or edit an
  already-applied migration — add a new one instead.
- Prefer idempotent DDL (`IF NOT EXISTS`) so a migration is safe to re-run and
  safe against a pre-existing DB. The baseline `migrations/0001_initial_schema.sql`
  is fully idempotent for exactly this reason (the production DB already had the
  tables when migrations were adopted).
- `npm run db:migrate` applies pending migrations to the **remote/production** DB
  (needs Cloudflare credentials); `db:migrate:local` targets the local DB. Deploy
  does the remote apply automatically, so manual `db:migrate` is only for
  out-of-band fixes.
- `server/schema.sql` is a legacy **destructive** full-reset script kept for
  convenience only — it is **not** part of the migration flow and must never be
  run against production. `server/data.sql` is manual demo/seed data, also not a
  migration.

## Conventions

- Package manager: **npm** (commit `package-lock.json`). Node 22 (`engines`
  requires `^20.19.0 || >=22.12.0`).
- No linter/formatter is configured. Code style: tabs for indentation in
  `server/`; match the surrounding file.
- Never return an organization's `access_key` to clients (see `PublicOrganization`
  in `shared/types.ts`).
