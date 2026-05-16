# Digital Kingsmen Portal API

REST API backend for the Digital Kingsmen client/team portal. Powers project visibility, service progress, messaging, file sharing, approvals, and role-based dashboards.

## Stack

- Node.js + Express + TypeScript
- PostgreSQL + Prisma ORM
- JWT Bearer authentication
- Zod validation
- Local file storage (S3-ready abstraction)
- OpenAPI docs at `/api/docs`

## Quick start

### Prerequisites

- Node.js 20+
- PostgreSQL 16+ (or Docker)

### Setup

```bash
npm install
cp .env.example .env
# Edit DATABASE_URL and JWT_SECRET in .env
#
# Homebrew PostgreSQL (macOS): use your macOS username, e.g.
#   DATABASE_URL=postgresql://adam@localhost:5432/digital_kingsmen_portal
# Docker: use postgres/postgres (see docker-compose.yml)

# Start PostgreSQL (Docker — optional)
docker compose up -d postgres

# Run migrations and seed
npm run db:migrate
npm run db:seed

# Start dev server
npm run dev
```

API base URL: `http://localhost:3003/api` (or whatever `PORT` is in `.env`, range 3001–3005)  
Swagger UI: `http://localhost:3003/api/docs`

## Demo credentials

All seeded users share password: `Demo123!`

| Email | Role |
|-------|------|
| admin@digitalkingsmen.com | admin |
| pm@digitalkingsmen.com | employee (PM) |
| salesman@digitalkingsmen.com | salesman |
| employee@digitalkingsmen.com | employee |
| client-pure@example.com | client (Pure Heating) |
| client-four@example.com | client (Four Seasons) |
| client-clean@example.com | client (Clean Slate) |

**Invite token (unused):** `demo-invite-token-for-new-client` for `newclient@example.com`

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run production build |
| `npm run db:migrate` | Create/apply migrations |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Prisma Studio |
| `npm test` | Run Vitest tests |

## Docker

```bash
docker compose up --build
```

Runs PostgreSQL + API (default port 3003).

## API overview

### Authentication

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "admin@digitalkingsmen.com", "password": "Demo123!" }
```

Response:

```json
{
  "success": true,
  "data": {
    "accessToken": "<jwt>",
    "expiresIn": 604800,
    "user": { "id": "...", "email": "...", "role": "admin" }
  }
}
```

Use header on all protected routes:

```http
Authorization: Bearer <accessToken>
```

### Main endpoints

| Area | Endpoints |
|------|-----------|
| Auth | `POST /auth/register`, `/login`, `/logout`, `GET /me` |
| Users | `GET/POST/PATCH/DELETE /users` (admin) |
| Companies | `GET/POST/PATCH/DELETE /companies` |
| Projects | `GET/POST/PATCH/DELETE /projects`, `/dashboard`, `/progress`, `/nudge` |
| Services | `/projects/:id/services`, `/project-services/:id` |
| Steps | `/project-services/:id/steps`, `/service-steps/:id` |
| Tasks | `/tasks`, `/tasks/:id/comments` |
| Updates | `/projects/:id/updates`, `/project-updates/:id` |
| Messages | `/conversations`, `/conversations/:id/messages` |
| Files | `/files`, `POST /files/upload`, `/files/:id/download` |
| Approvals | `/approvals`, `/approve`, `/request-revision` |
| Requests | `/client-requests`, `/convert-to-task` |
| Reports | `/reports` |
| Notifications | `/notifications`, `/read-all` |
| Announcements | `/announcements` |
| Dashboards | `/dashboard/admin`, `/client`, `/salesman`, `/employee` |
| Invites | `POST /invites` (admin) |
| Internal notes | `GET/POST /internal-notes` (not for clients) |

List endpoints support: `?page=1&limit=20&search=&status=&sortBy=createdAt&sortOrder=desc`

## Connecting from Lovable (React)

1. Set API base URL: `http://localhost:3003/api` (or your `PORT` from `.env`).
2. On login, store `data.accessToken` from `POST /auth/login`.
3. Attach to every request:

```typescript
const res = await fetch(`${API_URL}/projects`, {
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
});
const json = await res.json();
if (!json.success) {
  throw new Error(json.error.message);
}
```

4. Use `GET /auth/me` for user role and company memberships (do not trust JWT payload alone for UI).
5. Registration: admin creates invite via `POST /api/invites`, user registers with `invite_token` from URL.
6. File uploads: `multipart/form-data` to `POST /api/files/upload` with field name `file`.

## Security

All permissions are enforced server-side by role:

- **admin** — full access
- **client** — own company/projects only; no internal notes/messages/updates
- **salesman** — assigned companies/projects
- **employee** — assigned projects/tasks

## Project structure

```
src/
  config/       # Environment
  controllers/  # Route handlers
  middleware/   # Auth, validation, errors
  permissions/  # Access control
  routes/       # Express routers
  services/     # Business logic
  storage/      # File storage providers
  validators/   # Zod schemas
prisma/         # Schema, migrations, seed
tests/          # Vitest + Supertest
```

## Future integrations

See `src/integrations/ghl/` for GoHighLevel placeholder.
