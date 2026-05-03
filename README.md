# SarSync

Self-hosted kanban for cross-functional teams with built-in role hierarchy
(admin → dept manager → team lead → member → guest).

## Stack

- **Frontend:** Vite + React + React Router (`apps/web`)
- **Backend:** Fastify + TypeScript + Prisma (`apps/api`)
- **Database:** PostgreSQL 16 (Docker)
- **Cache/Sessions:** Redis 7 (Docker)
- **Auth:** JWT (access + refresh) + Google OAuth (optional)
- **Real-time:** Socket.io (kanban drag updates)
- **Shared types:** `packages/shared`
- **Target host:** AWS (App Runner + RDS + S3 + CloudFront)

## Local development

### Prerequisites

- Node 20+ and npm 10+
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

### First-time setup

```bash
# 1. Install all workspace deps
npm install

# 2. Boot Postgres + Redis
npm run db:up

# 3. Backend env
cp apps/api/.env.example apps/api/.env
# Edit .env: generate JWT_SECRET / JWT_REFRESH_SECRET via:
#   openssl rand -hex 32

# 4. Run migrations + seed
npm run prisma:migrate -- --name init
npm run prisma:seed
```

### Daily development

```bash
npm run db:up      # postgres + redis (idempotent)
npm run dev:api    # http://localhost:4000
npm run dev:web    # http://localhost:5173
```

Default seed login: `sara@sarsync.com` / `sarsync-secret`

### Useful commands

```bash
npm run prisma:studio    # GUI for the DB
npm run prisma:reset     # nuke + reseed
npm run db:logs          # follow postgres logs
npm run db:down          # stop containers
```

## Repo layout

```
sarsync/
├── apps/
│   ├── web/      Vite + React frontend
│   └── api/      Fastify + Prisma backend
├── packages/
│   └── shared/   shared TypeScript types (DTOs)
├── docker-compose.yml
└── package.json  (npm workspaces)
```
