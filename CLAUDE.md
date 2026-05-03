# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project context

SarSync is a self-hosted kanban product for cross-functional teams with a built-in role hierarchy (admin → dept_manager → team_lead → member → guest). The frontend was ported from a Claude Design prototype (HTML/CSS/JS) into a real Vite + React app. The backend was scaffolded but **most API endpoints are not implemented yet** — the frontend currently reads from `apps/web/src/data/` mock files. Wiring `apps/web` to the API is the in-progress work.

The user is Arabic-speaking. RTL/Arabic is a first-class concern, not an afterthought.

Target host is AWS (App Runner + RDS + S3 + CloudFront), but local Docker development is the priority until features are stable.

## Commands

All commands run from the repo root; npm workspaces handle the rest.

```bash
npm install              # install all workspace deps
npm run db:up            # boot Postgres + Redis (Docker)
npm run db:down          # stop containers
npm run db:logs          # follow postgres logs

npm run dev:api          # Fastify on :4000 with tsx watch
npm run dev:web          # Vite on :5173
npm run build:web        # production bundle into apps/web/dist
npm run build:api        # tsc -> apps/api/dist

npm run prisma:migrate   # creates a new migration; pass `-- --name foo`
npm run prisma:reset     # nuke DB + reseed
npm run prisma:seed      # rerun seed against existing DB
npm run prisma:studio    # GUI at :5555
npm run prisma:generate  # regenerate Prisma client (after schema edits)
```

### Tests

Vitest covers the API. Tests use `app.inject()` against a separate Postgres database (`sarsync_test`) — they do not start a real port. Each test starts with the schema fresh + DB truncated.

```bash
# One-time: create the test database
docker exec sarsync-db psql -U sarsync -d postgres -c "CREATE DATABASE sarsync_test"

# Run the suite
npm run test -w @sarsync/api          # one shot
npm run test:watch -w @sarsync/api    # watch mode
```

Test fixtures live in `apps/api/test/helpers.ts` — `signupUser()` and `addMember()` give you tokens fast. Adding a new test: create `apps/api/test/<name>.test.ts`, call `withCleanDb()` inside the `describe`, build users with the helpers, exercise endpoints via `app.inject()`.

## Architecture

### Monorepo

npm workspaces, three packages:
- `apps/web` — Vite + React + React Router. JSX (not TSX). No CSS framework — all styles are inline.
- `apps/api` — Fastify + TypeScript + Prisma. ESM, `tsx watch` for dev.
- `packages/shared` — TypeScript wire types (DTOs) imported by both sides as `@sarsync/shared`. Single source of truth for the shape of data crossing the network.

### Frontend theming and settings (read before touching UI)

The frontend has **three visual themes** — `minimal`, `playful`, `dark` — produced by `buildTheme(name, accent)` in `apps/web/src/ui/theme.js`. Every component takes a `theme` token object and reads from it (`theme.text`, `theme.surface`, `theme.accentSoft`, etc.). To change visual treatment of any element, edit `theme.js` rather than the component, unless the change is component-specific.

Global settings (theme, accent, density, RTL, fontScale, showAvatars) live in `SettingsContext` (`src/state/SettingsContext.jsx`) and persist to `localStorage` under `sarsync:settings:v1`. Read with `useSettings()`.

### RTL is direction-aware, not a flag

Arabic users matter. Hard-won rules:

- **Don't manually flip `gridTemplateColumns` for RTL.** `direction: rtl` already flips visual column order. Flipping twice (template + RTL) breaks layout — this caused a real bug in the Admin Console grid.
- Use **logical properties**: `borderInlineEnd`, `marginInlineStart`, `paddingInlineEnd`, `textAlign: 'end'` instead of physical `borderRight` / `marginLeft` / `textAlign: 'right'`.
- The font family switches to `IBM Plex Sans Arabic` in RTL via `fontFamilyFor(rtl)` in `theme.js`.
- The `direction: rtl` lives on the outermost shell; let it cascade.

### Drag and drop

Native HTML5 DnD via `DragProvider` + `DragCtx` in `apps/web/src/state/board-state.jsx`. Cards subscribe via `useContext(DragCtx)`; lists handle `onDragOver` to claim end-of-list drop slots. State lives in `useBoardState` and currently mutates a local React state tree — when wiring to the API, the move handler must call the backend (`PATCH /cards/:id/move`) and Socket.io should broadcast.

### Routing model

`App.jsx` defines all routes. `AppShell` (`src/kanban/AppShell.jsx`) wraps the in-app pages with TopBar + Sidebar. Auth screens render full-bleed without the shell. The card modal opens via `?card=ID` query param on `/b/:id` (deep-linkable).

### Backend conventions

- Env validated via zod in `apps/api/src/config.ts` — boot fails fast if `JWT_SECRET` < 32 chars or `DATABASE_URL` invalid. Add new env vars to the schema, not just to `.env.example`.
- `apps/api/src/db.ts` exports a singleton Prisma client; reuse it (don't `new PrismaClient()` per request — exhausts connection pool under hot reload).
- Logging is `pino-pretty` in dev, structured JSON in prod (controlled by `NODE_ENV`).

### Domain model (Prisma schema)

The schema in `apps/api/prisma/schema.prisma` is **the** source of truth for the data model. Key relationships:

- `Workspace` → `Department` → `Team` is the org tree. Each level cascades on delete.
- `Membership` is the `(User, Workspace)` join with `role`, `departmentId`, `teamId`. The same user can belong to multiple workspaces with different roles. Permission checks always start from `Membership.role`.
- `Board` is scoped to a workspace and optionally pinned to a `Department` and/or `Team` — those FKs drive role-based visibility (admin sees all; dept_manager sees their dept; member sees their team).
- `List` and `Card` use `position: Float` for **fractional indexing** — moving a card sets it to the midpoint of its neighbors, no row reflow needed. Don't replace this with sequential integers.
- `Activity` is an append-only log per board for the activity feed.

The `Role` enum (`admin`, `dept_manager`, `team_lead`, `member`, `guest`) and the permissions matrix in the seed (mirrored in `apps/web/src/data/org-data.js` for now) are the basis of all access control. When you add a new permission, add it to the matrix in both places until they're unified.

### Mock-data → API transition

`apps/web/src/data/board-data.js` and `apps/web/src/data/org-data.js` contain hardcoded fixtures the UI currently reads. The seed (`apps/api/prisma/seed.ts`) intentionally creates the **same** users, workspace, departments, teams, and labels — so when API endpoints come online, swapping `import { ROADMAP } from '../data/board-data'` for `await fetch('/api/boards/:id')` should produce visually identical screens.

When implementing an API endpoint that maps to a screen, mirror the field names from the corresponding fixture object — that minimizes frontend churn.

## Gotchas

- **The frontend is JSX (not TSX), the backend is TS.** Don't "convert" web to TypeScript without asking — the prototype was JSX and the user has not signed up for that migration.
- **There's no git history yet.** Don't run `git log` expecting context; ask the user.
- **Docker may not be installed locally.** `npm run db:up` will fail until the user installs Docker Desktop. Don't assume the DB is reachable.
- **The original prototype lived in a single HTML file using `Object.assign(window, ...)` to share globals.** All `apps/web/src/` code has been converted to ES modules with explicit imports — keep it that way; don't reintroduce window globals.
- **Auth screens currently link between each other but don't actually authenticate.** `/auth/signin` → "Sign in" navigates to `/auth/workspace` → `/boards` with no token check. This is intentional placeholder behavior until the auth API lands.
