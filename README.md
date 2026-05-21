# Digital Kingsmen Portal API

REST API for the Digital Kingsmen client portal. Runs on **Cloudflare Workers** with **D1** (database) and **R2** (file storage).

## Stack

- Express.js on Cloudflare Workers (`nodejs_compat`)
- **D1** — SQLite at the edge (replaces PostgreSQL)
- **R2** — object storage for uploads (replaces local disk)
- Prisma ORM + `@prisma/adapter-d1`
- JWT Bearer auth, Zod validation, role-based permissions

## Prerequisites

- Node.js 20+
- Cloudflare account ([wrangler login](https://developers.cloudflare.com/workers/wrangler/commands/#login))
- Wrangler CLI (included as dev dependency)

## Quick start (Cloudflare-native)

```bash
npm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars — set JWT_SECRET (min 16 chars)

# Apply D1 schema + seed demo data (local D1)
npm run cf:setup:local

# Start API (http://localhost:8787)
npm run dev
```

**API base URL:** `http://localhost:8787/api`  
**Swagger:** `http://localhost:8787/api/docs`

### Demo login

Password for all seeded users: `Demo123!`

| Email | Role |
|-------|------|
| admin@digitalkingsmen.com | admin |
| client-pure@example.com | client |
| salesman@digitalkingsmen.com | salesman |

```bash
curl -X POST http://localhost:8787/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@digitalkingsmen.com","password":"Demo123!"}'
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Wrangler dev (D1 + local uploads) |
| `npm run dev:node` | Node-only dev with SQLite file (`prisma/dev.db`) |
| `npm run deploy` | Deploy Worker to Cloudflare |
| `npm run cf:migrate:local` | Apply D1 migrations (local) |
| `npm run cf:migrate:remote` | Apply D1 migrations (production D1) |
| `npm run cf:setup:local` | Migrate + seed local D1 |
| `npm run db:seed:cf` | Seed via Wrangler D1 binding |
| `npm run cf:types` | Generate Worker binding types |

## Deploy to production

### Already done (automated)

- Remote D1 migrations applied (`0001_init.sql`)
- Worker bundle uploaded to Cloudflare
- `JWT_SECRET` secret set on the Worker (rotate before real traffic — see below)

### You must do (one-time)

1. **Register a `workers.dev` subdomain** (required before the API is reachable):
   - Open [Workers onboarding](https://dash.cloudflare.com/cca5a114f4b3baf1459a9b2697cad2e1/workers/onboarding)
   - Pick a subdomain (e.g. `digitalkingsmen`)
2. **Finish deploy** from the project root:
   ```bash
   npm run deploy
   ```
3. **Set a production JWT secret** (replace the dev value currently uploaded):
   ```bash
   npx wrangler secret put JWT_SECRET
   ```
4. **Seed demo data on remote D1** (optional):
   ```bash
   npm run cf:setup:local   # only if you need local again
   CF_SEED=1 npm run db:seed:cf   # seeds *local* D1
   ```
   For remote seed after deploy, use Dashboard → D1 → `portal-db` → import, or run seed SQL via `wrangler d1 execute portal-db --remote`.
5. **Update CORS** in [wrangler.toml](wrangler.toml) `CORS_ORIGIN` with your frontend URL(s), then `npm run deploy` again.

Your API will be at `https://digital-kingsmen-portal-api.<your-subdomain>.workers.dev`

### Custom domain

Cloudflare Dashboard → Workers → your worker → Custom Domains → add `api.yourdomain.com`

## Enable R2 for production uploads

1. Enable R2 in [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. `npx wrangler r2 bucket create portal-uploads`
3. Uncomment `[[r2_buckets]]` in [wrangler.toml](wrangler.toml)
4. Set `STORAGE_DRIVER = "r2"` under `[vars]`
5. Redeploy

Until R2 is enabled, uploads are stored in memory inside the Worker (fine for local dev; not durable across requests or deploys).

## Lovable / React frontend

1. Base URL: `https://<your-worker>.workers.dev/api` or custom domain
2. Login → store `data.accessToken`
3. Header: `Authorization: Bearer <token>`
4. Handle `{ success: false, error: { code, message } }`

## Local Node dev (optional)

For debugging without Wrangler:

```bash
cp .env.example .env
npm run db:push
npm run db:seed
npm run dev:node
```

Uses `file:./prisma/dev.db` instead of D1.

## Project structure

```
src/
  worker.ts          # Cloudflare Workers entry (production)
  index.ts           # Node entry (optional local dev)
  bootstrap.ts       # Init D1 Prisma + storage
  routes/ controllers/ services/ permissions/
migrations/          # D1 SQL migrations
prisma/
  schema.prisma      # sqlite provider
  seed.ts
wrangler.toml        # D1, vars, deploy config
```

## Notes

- D1 does not support transactions yet; Prisma runs queries individually.
- PostgreSQL migrations in `prisma/migrations/` are archived; use `migrations/` for D1.

### Staff client assignments

Team management and the admin **Team** page list assignments from the `company_staff_assignments` table (`GET /api/users/:id/staff-assignments` for a user; `POST/DELETE /api/companies/:companyId/staff-assignments` to mutate).

Legacy columns `assignedSalesmanId` and `assignedProjectManagerId` on `companies` are synced when assignments change, but **assignments that exist only in those legacy fields** (no row in `company_staff_assignments`) will not appear on the Team page until migrated. Use client hub staff editing or create assignment rows via the API to align data.
