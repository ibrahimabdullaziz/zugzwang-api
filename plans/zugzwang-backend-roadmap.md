# Zugzwang — Backend Mentor Roadmap

**What this is:** a phase-by-phase, task-by-task build plan for the Zugzwang backend. Each task names the files you touch and what goes in them. You write every line yourself; this document tells you _what_ and _why_, not the full code.

**Stack:** Node.js · Express · TypeScript (strict) · PostgreSQL · Prisma · Socket.io · chess.js · Stockfish (UCI) · Redis (ioredis) · BullMQ · Zod · Pino · Docker · GitHub Actions.

**Explicitly out of scope here:** the frontend, your custom ORM/query builder, your custom rate limiter (those are separate builds for later). Microservices live in the Bonus phase only.

**How to use it:** work top to bottom. Don't start a phase until the previous checkpoint passes. Commit after each task. If you're stuck for more than 30 minutes, ask a specific question.

---

## 0. Ground rules (read once, apply everywhere)

1. **Server-authoritative.** The client never decides anything: not legality of a move, not time, not results. It sends intent; the server validates and broadcasts.
2. **Modular monolith.** One deployable codebase, strict module boundaries. A module only imports another module through its `index.ts` (its public API), never its internals.
3. **Pure domain core.** Chess rules, Elo math, clock math and move scoring are plain functions/classes with zero I/O. Everything else wraps them.
4. **Factory functions with injected dependencies** (same pattern as Shelter): `createGamesService({ repo, publisher, logger })`. This is what makes the testing phase painless.
5. **Anything slow goes to a queue.** Emails, analysis, cleanup. The request/socket handler returns fast.
6. **Two process types, one codebase:** `server.ts` (API + sockets) and `worker.ts` (BullMQ workers).
7. **Idempotency by default.** Finishing a game twice must not change ratings twice. A job running twice must not duplicate rows.
8. **Testing gets its own phase near the end**, as you asked. But design for testability from day one so that phase isn't a rewrite.

### Decision records (write these as you go, 10–20 lines each, in `docs/adr/`)

| ADR | Question                                                                      |
| --- | ----------------------------------------------------------------------------- |
| 001 | Who owns a live game's in-memory state when there are multiple API instances? |
| 002 | Persist every move immediately vs buffer in memory/Redis and flush?           |
| 003 | Clock design: what is the source of truth and how do we avoid drift?          |
| 004 | Module boundaries and what each module may depend on                          |
| 005 | When is it worth extracting a service? (used in Bonus)                        |

---

## 1. Folder structure

```
zugzwang-backend/
├── prisma/
│   ├── schema.prisma
│   └── seed.ts
├── src/
│   ├── app.ts                  # createApp(deps) — no listen()
│   ├── server.ts               # http + socket.io + listen + shutdown wiring
│   ├── worker.ts               # BullMQ workers entrypoint
│   ├── config/
│   │   ├── env.ts              # zod-validated env
│   │   ├── logger.ts           # pino
│   │   ├── redis.ts            # ioredis connections
│   │   └── queues.ts           # queue names, default job options
│   ├── common/
│   │   ├── errors/             # AppError, error codes
│   │   ├── middleware/         # authGuard, roleGuard, validate, errorHandler, requestContext
│   │   ├── security/           # password.ts, tokens.ts
│   │   ├── cache/              # cache.ts (cache-aside helpers)
│   │   ├── pagination/         # cursor.ts
│   │   ├── lifecycle/          # shutdown.ts
│   │   └── types/              # express.d.ts, shared types
│   ├── db/prisma.ts
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── chess/              # pure domain (ChessGame, outcomes, PGN)
│   │   ├── games/              # REST + persistence + finishGame orchestration
│   │   ├── realtime/           # socket server, events contract, session manager
│   │   ├── matchmaking/
│   │   ├── clocks/
│   │   ├── ratings/            # elo, leaderboard
│   │   ├── engine/             # UCI wrapper, engine pool
│   │   ├── analysis/           # scoring + analysis service
│   │   ├── jobs/               # producers, processors
│   │   ├── notifications/      # email
│   │   ├── health/
│   │   └── metrics/
│   └── scripts/                # play-random.ts, socket-play.ts, load tests
├── test/
│   ├── unit/ · integration/ · e2e/ · helpers/
├── docs/
│   ├── adr/ · realtime.md · analysis.md · security.md · perf.md · resilience.md · 12-factor.md · runbook.md
├── docker-compose.yml · docker-compose.test.yml · Dockerfile
└── package.json · tsconfig.json · .env.example · README.md
```

Each module follows: `x.routes.ts` → `x.controller.ts` → `x.service.ts` → `x.repository.ts`, plus `x.schemas.ts` (Zod), `x.types.ts`, `index.ts` (public API).

---

## 2. Data model (target Prisma schema)

```prisma
enum Role { USER ADMIN }
enum GameMode { PVP VS_ENGINE }
enum GameStatus { WAITING ACTIVE FINISHED ABANDONED }
enum GameResult { WHITE_WIN BLACK_WIN DRAW }
enum ResultReason { CHECKMATE RESIGNATION TIMEOUT STALEMATE INSUFFICIENT_MATERIAL THREEFOLD FIFTY_MOVE DRAW_AGREEMENT ABANDONED }
enum RatingCategory { BULLET BLITZ RAPID }
enum AnalysisStatus { PENDING RUNNING DONE FAILED }
enum MoveClass { BEST GOOD INACCURACY MISTAKE BLUNDER }

model User {
  id              String   @id @default(uuid())
  email           String   @unique
  username        String   @unique
  passwordHash    String
  role            Role     @default(USER)
  emailVerifiedAt DateTime?
  createdAt       DateTime @default(now())
  ratings         Rating[]
  refreshTokens   RefreshToken[]
  whiteGames      Game[]   @relation("White")
  blackGames      Game[]   @relation("Black")
}

model RefreshToken {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique
  familyId  String            // for reuse detection
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime @default(now())
  @@index([userId])
  @@index([familyId])
}

model Rating {
  id          String         @id @default(uuid())
  userId      String
  user        User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  category    RatingCategory
  value       Int            @default(1200)
  gamesPlayed Int            @default(0)
  updatedAt   DateTime       @updatedAt
  @@unique([userId, category])
  @@index([category, value(sort: Desc)])      // leaderboard
}

model RatingHistory {
  id        String         @id @default(uuid())
  userId    String
  gameId    String
  category  RatingCategory
  before    Int
  after     Int
  createdAt DateTime       @default(now())
  @@index([userId, createdAt])
}

model Game {
  id             String        @id @default(uuid())
  inviteCode     String?       @unique
  mode           GameMode      @default(PVP)
  status         GameStatus    @default(WAITING)
  rated          Boolean       @default(true)
  whiteId        String?
  blackId        String?       // null for engine side
  white          User?         @relation("White", fields: [whiteId], references: [id])
  black          User?         @relation("Black", fields: [blackId], references: [id])
  engineLevel    Int?
  category       RatingCategory
  baseSeconds    Int
  incrementSecs  Int           @default(0)
  result         GameResult?
  reason         ResultReason?
  finalFen       String?
  pgn            String?
  whiteRatingBefore Int?
  blackRatingBefore Int?
  whiteRatingAfter  Int?
  blackRatingAfter  Int?
  startedAt      DateTime?
  finishedAt     DateTime?
  createdAt      DateTime      @default(now())
  moves          Move[]
  analysis       GameAnalysis?
  @@index([whiteId, createdAt(sort: Desc)])
  @@index([blackId, createdAt(sort: Desc)])
  @@index([status])
}

model Move {
  id           String   @id @default(uuid())
  gameId       String
  game         Game     @relation(fields: [gameId], references: [id], onDelete: Cascade)
  ply          Int
  san          String
  uci          String
  fenAfter     String
  timeSpentMs  Int
  clockAfterMs Int
  createdAt    DateTime @default(now())
  @@unique([gameId, ply])      // last line of defense against duplicate moves
}

model GameAnalysis {
  id            String         @id @default(uuid())
  gameId        String         @unique     // makes "request analysis" idempotent
  game          Game           @relation(fields: [gameId], references: [id], onDelete: Cascade)
  status        AnalysisStatus @default(PENDING)
  depth         Int
  accuracyWhite Float?
  accuracyBlack Float?
  failureReason String?
  moves         MoveAnalysis[]
  createdAt     DateTime       @default(now())
  completedAt   DateTime?
}

model MoveAnalysis {
  id          String       @id @default(uuid())
  analysisId  String
  analysis    GameAnalysis @relation(fields: [analysisId], references: [id], onDelete: Cascade)
  ply         Int
  evalBeforeCp Int
  evalAfterCp  Int
  bestMoveUci String
  winPctDrop  Float
  class       MoveClass
  @@unique([analysisId, ply])
}
```

**Time-control → category rule (put in `ratings/category.ts`):** estimated duration = `base + 40 × increment`. `< 180s` BULLET, `< 600s` BLITZ, otherwise RAPID.

---

## 3. Socket.io event contract (your single source of truth)

**Client → Server**
| Event | Payload | Notes |
|---|---|---|
| `queue:join` | `{ baseSeconds, incrementSecs }` | enter matchmaking |
| `queue:leave` | `{}` | |
| `game:join` | `{ gameId }` | join as player (re-join) or spectator |
| `game:move` | `{ gameId, uci }` | ack callback `{ ok, error? }` |
| `game:resign` | `{ gameId }` | |
| `game:draw:offer` / `accept` / `decline` | `{ gameId }` | |

**Server → Client**
| Event | Payload |
|---|---|
| `queue:matched` | `{ gameId }` |
| `game:state` | full snapshot: fen, moves, clocks, players, status, your color |
| `game:move` | `{ ply, san, uci, fen, clocks }` |
| `game:over` | `{ result, reason, ratingChanges }` |
| `game:opponent:disconnected` | `{ graceSeconds }` |
| `game:opponent:reconnected` | `{}` |
| `game:error` | `{ code, message }` |
| `analysis:progress` / `analysis:ready` | `{ gameId, ... }` |
| `server:shutdown` | `{ reconnectInMs }` |

Define these as TypeScript interfaces (`ClientToServerEvents`, `ServerToClientEvents`) and a Zod schema per client payload. Never trust a socket payload.

---

# PHASES

---

## PHASE 0 — Project setup & tooling

### Task 0.1 — Init and tooling

Files: `package.json`, `tsconfig.json`, `.eslintrc`/`eslint.config`, `.prettierrc`, `.gitignore`, `.env.example`

- `strict: true`, `noUncheckedIndexedAccess: true`. Don't weaken it to silence errors.
- Scripts: `dev`, `build`, `start`, `worker`, `lint`, `typecheck`, `db:migrate`, `db:seed`.
- Runtime deps: express, zod, pino, pino-http, helmet, cors, socket.io, chess.js, @prisma/client, ioredis, bullmq, jsonwebtoken, argon2, nanoid, nodemailer, prom-client. Dev: typescript, tsx/ts-node-dev, prisma, eslint, types.

### Task 0.2 — Typed config

File: `src/config/env.ts`

- Parse `process.env` with Zod once at startup; export a frozen typed `config`. Fail fast with a readable message listing every invalid/missing variable.
- Groups: server (port, nodeEnv, corsOrigins), db, redis, jwt (secrets, ttls), engine (binary path, pool size), email, logging level, feature flags.
- Rule: nothing else in the codebase reads `process.env`.

### Task 0.3 — Logger

File: `src/config/logger.ts`

- Pino. Pretty transport in dev, JSON in prod. `redact` for `req.headers.authorization`, `password`, `token`, `refreshToken`.
- Export `logger` and a `childLogger(bindings)` helper.

### Task 0.4 — Errors and HTTP base

Files: `common/errors/AppError.ts`, `common/errors/codes.ts`, `common/middleware/errorHandler.ts`, `common/middleware/validate.ts`, `common/utils/asyncHandler.ts`

- `AppError(code, httpStatus, message, details?)`. Error codes are an enum (`GAME_NOT_FOUND`, `NOT_YOUR_TURN`, `ILLEGAL_MOVE`, ...) so the frontend and tests can match on them.
- `errorHandler` maps: `AppError`, `ZodError` (400 with field details), Prisma known errors (unique violation → 409, not found → 404), everything else → 500 + log. Distinguish **operational** errors (expected) from **programmer** errors (bugs).
- `validate(schema, source)` validates `body | query | params`, rejects unknown keys (`.strict()`).
- One response envelope, used everywhere.

### Task 0.5 — App/server split

Files: `src/app.ts`, `src/server.ts`

- `createApp(deps)` builds Express (helmet, cors, json limit, routes, 404, errorHandler) and **never calls listen**. This is what Supertest will import later.
- `server.ts` creates `http.Server`, will attach Socket.io (Phase 5), and listens.

### Task 0.6 — Prisma singleton

File: `src/db/prisma.ts` — single `PrismaClient`; query logging at debug level in dev.

**Checkpoint:** `npm run dev` boots, `GET /health/live` returns 200, a deliberately bad env var prevents boot with a clear message.

---

## PHASE 1 — Database schema

### Task 1.1 — Enums, User, RefreshToken

`prisma/schema.prisma` — as in section 2. Think about why `RefreshToken` stores a **hash**, not the token (a DB leak must not leak sessions).

### Task 1.2 — Game and Move

- Why `whiteId`/`blackId` are nullable (engine games).
- Why `@@unique([gameId, ply])` exists even though your code should never insert a duplicate: it's the final safety net against a race.

### Task 1.3 — Rating and RatingHistory

- One `Rating` row per (user, category). Index for leaderboard sorting.

### Task 1.4 — GameAnalysis and MoveAnalysis

- `gameId @unique` on `GameAnalysis` is what makes "enqueue analysis" safe to call twice.

### Task 1.5 — Migrate and review indexes

- `prisma migrate dev --name init`. For each index, write one line in a comment: which query it serves.

### Task 1.6 — Seed script

File: `prisma/seed.ts`

- Create ~20 users with ratings, then generate finished games by playing random legal moves with chess.js (this reuses the Phase 3 playground). Include all result reasons.
- Add a flag to seed 100k games later for the EXPLAIN ANALYZE exercise (Phase 9).

**Checkpoint:** Prisma Studio shows realistic data; you can explain every index.

---

## PHASE 2 — Auth and users

### Task 2.1 — Password hashing

File: `common/security/password.ts` — `hashPassword`, `verifyPassword` using argon2. Know why it's slow on purpose.

### Task 2.2 — Tokens

File: `common/security/tokens.ts`

- Access JWT (15 min, contains `sub`, `role`). Refresh token = random opaque string (not a JWT), stored hashed with a `familyId`.
- `signAccessToken`, `verifyAccessToken`, `generateRefreshToken`, `hashToken`.

### Task 2.3 — Users module

Files: `users.repository.ts`, `users.service.ts`

- `create`, `findByEmail`, `findByUsername`, `findById`, `updateProfile`.

### Task 2.4 — Auth service

File: `auth.service.ts`

- `register`: in one transaction create the user and three `Rating` rows (BULLET/BLITZ/RAPID at 1200).
- `login`: constant-time compare, generic "invalid credentials" error (no user enumeration), issue access + refresh.
- `refresh` **with rotation**: mark old token revoked, issue a new one in the same family. If a revoked token is presented again → **reuse detected → revoke the whole family**.
- `logout` (revoke current), `logoutAll` (revoke all for user).

### Task 2.5 — Middleware

Files: `authGuard.ts`, `optionalAuth.ts`, `roleGuard.ts`, `common/types/express.d.ts`

- `authGuard` sets `req.user = { id, role }`. `optionalAuth` for public endpoints that behave differently when logged in.

### Task 2.6 — Routes

- `POST /auth/register|login|refresh|logout|logout-all`, `GET /auth/me`.
- `GET /users/:username` (public profile with ratings), `PATCH /users/me`, `GET /users?search=` (simple `ILIKE` now; upgraded in Bonus).
- Zod schemas for every input.

**Checkpoint:** register → login → refresh → reuse an old refresh token → entire family is revoked.

---

## PHASE 3 — Chess domain core (no I/O at all)

### Task 3.1 — Types

File: `modules/chess/types.ts` — `Color`, `Uci`, `Outcome { result, reason } | null`, `TimeControl`.

### Task 3.2 — ChessGame wrapper

File: `modules/chess/ChessGame.ts`

- Wraps `chess.js`. `fromFen`, `fromMoves(uciList)`, `applyMove(uci)` (throws a domain error if illegal), getters for `fen`, `turn`, `plyCount`, verbose history.
- `getOutcome()` maps chess.js state to your `Outcome`: checkmate, stalemate, insufficient material, threefold repetition, fifty-move rule. Know which of these chess.js detects automatically and which you must track.

### Task 3.3 — UCI helpers

File: `modules/chess/uci.ts` — regex validation (`^[a-h][1-8][a-h][1-8][qrbn]?$`), UCI ↔ SAN conversion given a position.

### Task 3.4 — PGN builder

File: `modules/chess/pgn.ts` — headers (White, Black, Date, Result, TimeControl, Termination) + movetext. Used for storage and export.

### Task 3.5 — Playground

File: `scripts/play-random.ts` — plays random legal games to the end, prints outcome distribution. Sanity-check that every outcome type is reachable. Seed reuses this.

**Checkpoint:** you can replay any seeded game's moves from the start and reach the same final FEN.

---

## PHASE 4 — Game REST API and persistence

### Task 4.1 — Repository

File: `games.repository.ts`

- `create`, `findById` (optionally with moves), `findByInviteCode`, `listByUser` (cursor, Phase 9), `appendMove` (in a transaction with the status update), `finish`.

### Task 4.2 — Service

File: `games.service.ts`

- `createChallenge(userId, timeControl, color?)` → WAITING game + invite code (`nanoid`, unique index).
- `joinByCode(userId, code)`: assign colors, set ACTIVE. **Race to think about:** two people join the same code at the same instant. Use a conditional update (`updateMany where status = WAITING`) and check the affected count.
- `getGame`, `resign`, `abort` (allowed only before the first move).
- Enforce **one active game per user** (check in service; ADR note on DB-level enforcement).

### Task 4.3 — Routes

- `POST /games`, `POST /games/join/:code`, `GET /games/:id`, `GET /games/:id/moves`, `POST /games/:id/resign`, `GET /games/me`.
- Authorization on every route: only participants can resign; spectators read-only.

### Task 4.4 — ADR-002

Decide and document: persist each move immediately vs buffer. Recommended starting point: **insert each move immediately** (small, durable, simplest to reason about). Note what you'd change if write load became a problem.

**Checkpoint:** create + join + resign work via HTTP only.

---

## PHASE 5 — Real-time layer (the heart of the project)

### Task 5.1 — Socket server

File: `realtime/socketServer.ts`

- `createSocketServer(httpServer, deps)`. Handshake middleware verifies the JWT from `auth.token`, sets `socket.data.user`. Reject unauthenticated handshakes. CORS from config.

### Task 5.2 — Typed contract

Files: `realtime/events.ts`, `realtime/schemas.ts`

- Section 3's interfaces + one Zod schema per client event. Use Socket.io's generics so `socket.on(...)` and `emit(...)` are type-checked.

### Task 5.3 — Rooms

- Room per game: `game:{id}`. `game:join` validates: player → joins as player; anyone else → spectator (read-only, receives state and moves).

### Task 5.4 — GameSession and manager

Files: `realtime/GameSession.ts`, `realtime/GameSessionManager.ts`

- A `GameSession` holds the `ChessGame` instance, player/spectator socket ids, clock state (Phase 7), timers.
- Manager: `Map<gameId, GameSession>`, `getOrLoad(gameId)` which **rehydrates from DB** by replaying stored moves. Rehydration is what you'll lean on for restarts (Phase 17) and multi-instance (Phase 10).

### Task 5.5 — The move pipeline (most important flow in the project)

File: `realtime/handlers/move.handler.ts`

1. Zod-validate payload.
2. Load session; verify the socket's user is the player whose turn it is.
3. `session.game.applyMove(uci)` — illegal → ack error, no broadcast.
4. Persist the move (Phase 4 repo).
5. Emit `game:move` to the room; ack `{ ok: true }`.
6. If `getOutcome()` is non-null → call `finishGame` (Phase 8).

- **Serialize per game:** two moves arriving "simultaneously" for one game must be processed one after another. Implement a small per-game async queue/mutex in `GameSession`. Be able to explain what bug appears without it.

### Task 5.6 — Resign and draw offers

- `game:resign` → finish with RESIGNATION. Draw offer state lives on the session (who offered, expires after the opponent moves).

### Task 5.7 — Disconnect and reconnect

- On disconnect: notify opponent with `game:opponent:disconnected { graceSeconds }`, start a grace timer (e.g. 30 s). If it fires → opponent wins by ABANDONED/TIMEOUT rule you choose. On reconnect: cancel the timer, send full `game:state`, notify opponent.
- Handle the same user connected from two tabs (decide: allow, or kick the older socket).

### Task 5.8 — Safe handlers

File: `realtime/safeHandler.ts` — wraps every handler: catches errors, maps `AppError` to `game:error`, logs, and **never lets one bad event crash the process**.

### Task 5.9 — Scripted bots

File: `scripts/socket-play.ts` — two socket clients that play a scripted game (fool's mate) end to end. This is your manual test harness until the testing phase.

**Checkpoint:** two scripted clients play a full game to checkmate; an illegal move and a move out of turn are rejected cleanly.

---

## PHASE 6 — Matchmaking (in-memory first, on purpose)

### Task 6.1 — Interface

File: `matchmaking/Matchmaker.ts` — `interface Matchmaker { enqueue(entry); dequeue(userId); tick(): Pair[] }`. The rest of the code depends on the interface, not the implementation.

### Task 6.2 — In-memory implementation

File: `matchmaking/InMemoryMatchmaker.ts`

- Queue per category. Pairing rule: same category, rating window that **widens with wait time** (e.g. ±100, +50 every 5 s), never pair a user with themselves.

### Task 6.3 — Matchmaking loop

File: `matchmaking/matchmaking.service.ts`

- `setInterval` tick → for each pair create a game (`games.service`) → emit `queue:matched` to both. Enforce "not already in an active game / not already queued".

### Task 6.4 — Socket events

- `queue:join` / `queue:leave`; remove the user from the queue on disconnect.

**Checkpoint:** two clients queue, get matched, and play. Write down in ADR-001 _why this breaks with two API instances_ — Phase 10 fixes it.

---

## PHASE 7 — Clocks and time controls

### Task 7.1 — Pure clock math

File: `clocks/Clock.ts`

- Inputs: base, increment, the sequence of move timestamps. Output: remaining time per side.
- Use a **monotonic clock** (`performance.now()` / `process.hrtime`) for elapsed time, not `Date.now()` (which can jump).

### Task 7.2 — Server timers

File: `realtime/GameSession.ts` (extend)

- After every move: cancel the old timeout, schedule a new one for `remaining(sideToMove)`. On fire → finish with TIMEOUT. Special case: timeout against a side with **insufficient mating material** is a draw, not a loss.

### Task 7.3 — Persist clock data

- Fill `timeSpentMs` and `clockAfterMs` on each `Move`.

### Task 7.4 — Clock events

- Send clock values **with each move**, not every second. The client interpolates locally. Explain in ADR-003 why server-side per-second ticking is wasteful and no more accurate.

### Task 7.5 — Edge rules

- Clock starts after white's first move; a game with no moves within an abort window (e.g. 30 s) is aborted without rating change. Document lag handling (simplest: no compensation; say so).

**Checkpoint:** a 1+0 game with a stalling player ends by timeout at the right second; increments work.

---

## PHASE 8 — Elo and ratings

### Task 8.1 — Elo math

File: `ratings/elo.ts` (pure)

- Expected score, K-factor policy (e.g. 40 under 30 games, 20 normal, 10 above 2400), score values (1 / 0.5 / 0), rounding. Table-driven so it's trivially testable.

### Task 8.2 — Category mapping

File: `ratings/category.ts` — the time-control rule from section 2.

### Task 8.3 — `finishGame` orchestration

File: `games/finishGame.ts` — **the most important transaction in the project.**
Inside one DB transaction:

1. Load the game row `FOR UPDATE`. If already FINISHED → return the existing result (**idempotency**).
2. If rated + PVP: lock both rating rows in a **fixed order** (by user id) to avoid deadlocks.
3. Compute new ratings, update `Rating`, increment `gamesPlayed`, insert two `RatingHistory` rows.
4. Update the `Game` (result, reason, final FEN, PGN, before/after ratings, `finishedAt`).
   After commit: emit `game:over`, publish the analysis job (Phase 13), invalidate caches (Phase 10), clear timers, release the session.

- Needs `$queryRaw` for `SELECT ... FOR UPDATE`. Be ready to explain what happens when `finishGame` is called twice concurrently (resign and timeout at the same instant).

### Task 8.4 — Unrated and engine games

- `rated = false` skips rating logic entirely.

### Task 8.5 — Endpoints

- `GET /leaderboard?category=&cursor=`, `GET /users/:username/rating-history?category=`.

**Checkpoint:** firing `finishGame` twice in parallel changes ratings exactly once.

---

## PHASE 9 — History, replay, stats (+ your Advanced DB exercises)

### Task 9.1 — Cursor pagination

File: `common/pagination/cursor.ts` — keyset pagination on `(createdAt, id)`. Know why offset pagination degrades on large tables.

### Task 9.2 — Game history with filters

- `GET /users/:username/games?result=&color=&category=&cursor=` — filters backed by the composite indexes.

### Task 9.3 — Replay and export

- `GET /games/:id/replay` → ordered moves with `fenAfter`, `san`, clocks. `GET /games/:id/pgn` → `text/plain`.

### Task 9.4 — Stats

- `GET /users/:username/stats`: W/D/L overall, by color, by category, average game length. Use `groupBy` or a raw aggregate with `COUNT(*) FILTER (WHERE ...)`.

### Task 9.5 — EXPLAIN ANALYZE session

- Seed 100k games. For the history query and the leaderboard query: capture the plan before/after adding the right index, note actual times in `docs/perf.md`. Look for Seq Scan vs Index Scan, and why a wrong index gets ignored.

**Checkpoint:** history is fast and stable at 100k games; you have a before/after table.

---

## PHASE 10 — Redis, caching and horizontal readiness

### Task 10.1 — Redis clients

File: `config/redis.ts`

- Separate connections for: cache, pub/sub, BullMQ (BullMQ needs its own with `maxRetriesPerRequest: null`). Reconnect strategy, ready/error logging.

### Task 10.2 — Cache helper

File: `common/cache/cache.ts`

- `getOrSet(key, ttl, loader)` (cache-aside), namespaced keys (`zz:v1:leaderboard:blitz`), JSON serialization, **TTL jitter**, and **stampede protection** (many concurrent misses → one loader call: in-process single-flight, optionally plus a short Redis lock).
- **A cache failure must never fail the request**: on Redis error, log and fall through to the DB.

### Task 10.3 — What to cache

| Data                     | TTL              | Invalidate when              |
| ------------------------ | ---------------- | ---------------------------- |
| Leaderboard per category | 30 s             | (TTL only)                   |
| Public profile           | 60 s             | rating changes for that user |
| Finished game replay/PGN | long (immutable) | never                        |
| User stats               | 60 s             | that user finishes a game    |

Write the invalidation matrix in `docs/perf.md`.

### Task 10.4 — Measure

- `autocannon` against leaderboard and replay before/after. Record numbers. If the numbers don't move, you cached the wrong thing.

### Task 10.5 — Redis matchmaker

File: `matchmaking/RedisMatchmaker.ts`

- Same interface as Phase 6. Sorted set per category scored by rating; pairing must be **atomic** (a small Lua script or `MULTI`) so two instances can't match the same player twice. Select implementation via config.

### Task 10.6 — Socket.io Redis adapter

- `@socket.io/redis-adapter` so a broadcast from instance A reaches sockets on instance B. Run two instances locally and verify.

### Task 10.7 — Presence and ADR-001 (the hard design question)

- `userId → gameId` registry in Redis with a heartbeat TTL for the "one active game" rule across instances.
- Decide who owns a live game's in-memory state. Options: (a) sticky routing by gameId; (b) a per-game **lease** in Redis (`SET key NX PX`) renewed while the game is live, with rehydration from DB on takeover. Write the ADR with pros/cons, pick one, implement it. Understand the failure mode of a lease that expires while its holder is paused.

**Checkpoint:** two API instances + Redis: one player on each, a full game plays correctly.

---

## PHASE 11 — Queues and background jobs (BullMQ)

### Task 11.1 — Queue config

File: `config/queues.ts`

- Queue names enum, default job options (attempts 5, exponential backoff, `removeOnComplete` / `removeOnFail` limits), typed payload schemas per queue.

### Task 11.2 — Producers

File: `jobs/producers.ts`

- `JobPublisher` **interface** (`publishAnalysis(gameId)`, `publishEmail(...)`) with a BullMQ implementation. Domain code depends on the interface, so tests can stub it.
- Deterministic `jobId` (e.g. `analysis:${gameId}`) so duplicates collapse.

### Task 11.3 — Worker entrypoint

File: `src/worker.ts`

- Registers processors with per-queue concurrency from config, wires logging for completed/failed/stalled events, and handles shutdown (Phase 17).

### Task 11.4 — Email queue

Files: `notifications/mailer.ts`, `jobs/processors/email.processor.ts`

- Nodemailer (Mailpit locally). Use it for: email verification, password reset. Add endpoints: `POST /auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password` with hashed, expiring tokens.

### Task 11.5 — Repeatable jobs

File: `jobs/processors/maintenance.processor.ts`

- Cleanup WAITING games older than 1 h, purge expired/revoked refresh tokens, abandon stale ACTIVE games.

### Task 11.6 — Failure handling

- After final attempt: log structured failure, mark the related entity (e.g. analysis `FAILED` with reason). Understand **at-least-once delivery** and why every processor must be idempotent.

### Task 11.7 — Queue dashboard

- Bull Board at `/admin/queues`, behind `authGuard + roleGuard(ADMIN)`.

**Checkpoint:** register → verification email arrives via the queue; kill the worker mid-job and see the job retried.

---

## PHASE 12 — Stockfish integration

### Task 12.1 — Choose how to run it

- System binary via `ENGINE_PATH` (recommended for the backend; in Docker you install it in the image) or an npm Stockfish build. Wrap whichever you pick behind an interface so tests can fake it.

### Task 12.2 — UCI wrapper

File: `engine/UciEngine.ts`

- Spawn a child process; speak UCI over stdin/stdout: `uci`, `isready`, `ucinewgame`, `setoption`, `position fen ...`, `go depth N | movetime N`, `stop`.
- Parse `info` lines (depth, `score cp|mate`, `pv`) and `bestmove`.
- Promise-based API: `evaluate(fen, { depth | movetime })` → `{ bestMoveUci, scoreCp | mate, depth, pv }`. Add timeouts, `stop` for cancellation, and **restart on crash**.

### Task 12.3 — Engine pool

File: `engine/EnginePool.ts`

- Fixed number of engine processes (config). `acquire()/release()` or `run(task)` with a bounded wait queue. **Backpressure:** when saturated and the queue is full, reject fast (503 / retryable) instead of piling up.

### Task 12.4 — Play vs computer

Files: `games/games.service.ts` (extend), `realtime/handlers/engineMove.ts`

- `POST /games/engine { level, color, baseSeconds?, incrementSecs? }` creates `mode = VS_ENGINE`, `rated = false`.
- After each human move the session asks the pool for a reply. Emit it like a normal move, with a small artificial delay so it doesn't feel instant.

### Task 12.5 — Difficulty table

- Document level 1–8 → `Skill Level` / `UCI_LimitStrength + UCI_Elo` / `movetime` in `docs/analysis.md`.

### Task 12.6 — CPU-bound vs I/O-bound, measured

- Run N concurrent engine games and watch event-loop delay (Phase 14 gives you the metric). Confirm the engine being an **external process** keeps the event loop responsive. Write down what would happen if engine search ran in-process.

**Checkpoint:** you can play a full game against level 1 and level 8; saturating the pool returns clean errors, not hangs.

---

## PHASE 13 — Post-game analysis

### Task 13.1 — Trigger

- At the end of `finishGame` (≥ 6 plies): upsert `GameAnalysis(status=PENDING)` and publish `analysis:{gameId}`. The unique `gameId` + deterministic job id make this idempotent.

### Task 13.2 — Scoring (pure functions)

File: `analysis/scoring.ts`

- Normalize every eval to **white's perspective**; convert mate scores to a capped cp value.
- cp → win probability with a logistic function; **win% drop** per move = how much the mover's win chance fell compared with the best line.
- Classify: BEST / GOOD / INACCURACY / MISTAKE / BLUNDER by win%-drop thresholds. Per-player **accuracy** from the move-level win% values. Document the exact formulas and thresholds in `docs/analysis.md`.

### Task 13.3 — Analysis service

File: `analysis/analysis.service.ts`

- Given the ordered FEN list, evaluate each position at a fixed depth via `EnginePool`, then compute `evalBefore/After` pairs and call `scoring`.

### Task 13.4 — Processor

File: `jobs/processors/analysis.processor.ts`

- Set status RUNNING, loop positions, `job.updateProgress`, write `MoveAnalysis` in batches with **upsert** semantics (a retry must not duplicate), compute summary, set DONE. On final failure set FAILED with a reason.

### Task 13.5 — Endpoints and events

- `GET /games/:id/analysis` → status + summary (accuracy per side, worst 3 moves per side) + per-move list.
- `POST /games/:id/analysis` → request on demand if missing (participants only).
- Emit `analysis:progress` / `analysis:ready` to the game's participants.

### Task 13.6 — Cost control

- Skip very short games, cap concurrent analyses per user, give user-requested analyses higher queue priority than automatic ones. Cache finished analysis (it is immutable).

**Checkpoint:** finishing a game produces an analysis with accuracy numbers and the 3 worst moves, and retrying the job doesn't create duplicates.

---

## PHASE 14 — Logging and observability

### Task 14.1 — Request/event context

Files: `common/middleware/requestContext.ts`, `common/context.ts`

- `AsyncLocalStorage` holding `{ requestId, userId, gameId?, socketId? }`. Pino `mixin` reads it, so **every log line is automatically correlated**. Honor/propagate an incoming `x-request-id`.

### Task 14.2 — HTTP logging

- `pino-http`: custom serializers, redaction, log level by status (5xx error, 4xx warn), skip `/health*` and `/metrics`.

### Task 14.3 — Domain logging conventions

- Structured events: `{ event: 'game.finished', gameId, result, reason, plies, durationMs }`. Write a short levels policy in the README (what is info vs warn vs error).

### Task 14.4 — Metrics

File: `modules/metrics/metrics.ts` (prom-client)

- Defaults + custom: `http_request_duration_seconds{method,route,status}` (use the **route pattern**, never the raw URL — cardinality!), `ws_connections`, `games_active`, `moves_total`, `game_finished_total{result,reason}`, `matchmaking_queue_size`, `matchmaking_wait_seconds`, `engine_pool_busy` / `engine_pool_waiting`, `job_duration_seconds{queue}`, `job_failed_total{queue}`, `event_loop_delay_seconds`.
- Expose `GET /metrics` (internal network only or protected).

### Task 14.5 — Health

- `/health/live` (process is up). `/health/ready` (DB ping, Redis ping, queue connection). Readiness turns false during shutdown.

### Task 14.6 — Process-level safety

- `unhandledRejection` / `uncaughtException`: log fatal, begin shutdown, exit non-zero (a supervisor restarts you). Explain why continuing after an uncaught exception is unsafe.

### Task 14.7 — (Optional) Dashboards

- Docker Compose profile with Prometheus + Grafana; build one dashboard: active games, move rate, p95 latency, queue depth, pool saturation.

**Checkpoint:** from one `requestId` you can follow a request through every log line; the dashboard shows a live game.

---

## PHASE 15 — Security hardening

### Task 15.1 — HTTP surface

- `helmet`, strict CORS allowlist from config, `x-powered-by` off, JSON body size limit, sensible query parsing.

### Task 15.2 — HTTP rate limiting

- Use `express-rate-limit` with a Redis store for now: strict on `/auth/*`, moderate on game creation and analysis requests. Return 429 with `Retry-After`. (This is the library-based version; your own limiter is a separate project.)

### Task 15.3 — Socket protection

- Max payload size, per-socket event throttle (simple in-memory token counter), max concurrent sockets per user, origin check, disconnect after repeated invalid payloads.

### Task 15.4 — Auth hardening

- Login attempt counter per email+IP in Redis with temporary lockout; refresh-token reuse detection (done in Phase 2); password rules; generic error messages; optionally require verified email for rated play.

### Task 15.5 — Authorization audit (BOLA)

- For every game/analysis endpoint and every socket event, write down who is allowed and where the check lives. Object-level authorization is the #1 API vulnerability class.

### Task 15.6 — Validation audit

- Every route and socket event has a strict Zod schema; pagination limits capped; UCI strings regex-checked; reject unknown keys.

### Task 15.7 — Secrets and dependencies

- No secrets in logs or the repo; `.env.example` only; `npm audit` and secret scanning (gitleaks) added to CI in Phase 20.

### Task 15.8 — Write `docs/security.md`

- OWASP API Top 10 table: each item → what you did, where.

**Checkpoint:** a user cannot read/resign/analyze someone else's game over HTTP _or_ sockets; brute-forcing login gets locked out.

---

## PHASE 16 — Performance and concurrency

### Task 16.1 — Baselines

- `autocannon` for REST (login, leaderboard, game fetch). Artillery with the Socket.io engine for N concurrent scripted games. Record numbers in `docs/perf.md`.

### Task 16.2 — Database

- Enable Prisma query logs, use `pg_stat_statements`, hunt N+1 queries; fix with `select`/`include` discipline and indexes. Understand connection pool sizing (`connection_limit`) and what PgBouncer would change.

### Task 16.3 — Event-loop health

- Chart `monitorEventLoopDelay` under load. Add a deliberate CPU hog endpoint to _see_ what blocking does, then remove it. Verify argon2 (native, threadpool) and the engine (child process) don't block. Experiment with `UV_THREADPOOL_SIZE`.

### Task 16.4 — Concurrency correctness

- Hammer one game with concurrent moves from a script: the per-game queue plus the `@@unique([gameId, ply])` constraint must keep state consistent. Treat a unique-violation as "duplicate/stale move", not a 500.

### Task 16.5 — Memory

- Make sure sessions, timers, listeners are cleaned up when a game ends. Take heap snapshots after 1,000 finished games; the session map must not grow.

### Task 16.6 — Response efficiency

- Select only needed columns, ETag/conditional GET for immutable resources (finished replay), compression for REST (not for already-small socket frames).

### Task 16.7 — Scale-out experiment

- docker-compose with 2–3 API instances behind Nginx (sticky sessions or not, per your ADR-001 choice) + Redis adapter. Prove a game works regardless of which instance each player lands on.

**Checkpoint:** `docs/perf.md` has a baseline table and at least three before/after improvements you can defend.

---

## PHASE 17 — Graceful shutdown and resilience

### Task 17.1 — Shutdown coordinator

File: `common/lifecycle/shutdown.ts`
Ordered, with a hard timeout (e.g. 15 s):

1. Mark readiness false (the load balancer stops sending traffic).
2. Stop accepting new HTTP connections and new socket handshakes.
3. Emit `server:shutdown { reconnectInMs }` to connected clients.
4. Wait for in-flight HTTP requests (handle keep-alive connections).
5. Persist anything in memory that matters (clock snapshot / draw offers if you keep them).
6. Close Socket.io → BullMQ queues → Redis → Prisma.
7. Exit 0.
   Handle `SIGTERM` and `SIGINT`; a second signal forces exit.

### Task 17.2 — Worker shutdown

- `worker.close()` waits for the active job (with a timeout). Verify a job interrupted mid-run is retried and that its processor is idempotent.

### Task 17.3 — Crash recovery on boot

- On startup, load ACTIVE games from the DB: rebuild sessions by replaying moves, recompute clocks from the last move timestamp plus time elapsed, re-arm timeouts. Games whose players are both gone past the grace window → ABANDONED.

### Task 17.4 — Chaos drills (write results in `docs/resilience.md`)

- `kill -TERM` mid-game · `kill -9` mid-game · stop Redis · restart Postgres · stop the worker. For each: what happened, what users see, what you fixed.

### Task 17.5 — Degradation policy

- Timeouts on DB/Redis calls. Redis down → cache disabled and the rest works. Define what is allowed to fail and what must not.

**Checkpoint:** you can `SIGTERM` an instance during a live game and the players reconnect to a consistent game.

---

## PHASE 18 — Testing (Mocha + Chai + Sinon, same style as Shelter)

### Task 18.1 — Setup

- Mocha + `tsx`/`ts-node`, Chai, Sinon, Supertest, `socket.io-client`, `c8`/nyc coverage. Scripts: `test:unit`, `test:integration`, `test:e2e`. `docker-compose.test.yml` with Postgres + Redis on non-default ports.

### Task 18.2 — Unit tests (pure code; the cheapest, highest value)

- Chess domain: fool's mate, stalemate, insufficient material, threefold, fifty-move, castling/en passant/promotion edge cases.
- Elo (table-driven), category mapping, clock math, matchmaking pairing + window widening, scoring/classification, UCI parser (feed recorded engine output), cache `getOrSet` (stub loader), shutdown ordering (Sinon fakes).

### Task 18.3 — Service tests with stubbed dependencies

- Auth service (refresh rotation + reuse detection), games service (join race with a stubbed repo), `finishGame` idempotency (called twice → one rating change).

### Task 18.4 — Integration tests (real Postgres + Redis)

- Repositories, transactions (two concurrent `finishGame` calls → single rating update), cursor pagination, unique-constraint behavior, BullMQ end to end with a fake engine.

### Task 18.5 — HTTP API tests (Supertest, `createApp`)

- Auth flows, authorization (can't touch someone else's game), validation errors, 429 behavior.

### Task 18.6 — Socket e2e tests

- Scenarios: full game to checkmate · illegal move rejected · move out of turn · resign · timeout (tiny time control or Sinon fake timers) · disconnect/reconnect inside and outside the grace period · spectator receives moves · matchmaking pairs two users · cross-instance play through the Redis adapter.

### Task 18.7 — Engine tests

- Pool and analysis against a deterministic **fake** `UciEngine`. One optional slow test with real Stockfish, tagged so CI can skip it.

### Task 18.8 — Test infrastructure

- Separate test database, migrate before the suite, truncate between tests; factories in `test/helpers/factories.ts`; helper to open authenticated socket clients.

### Task 18.9 — Coverage target

- Aim ~80% on domain + services. Don't chase 100% on glue code.

**Checkpoint:** one command runs the whole suite green from a clean checkout.

---

## PHASE 19 — API documentation

### Task 19.1 — OpenAPI from your Zod schemas

- Use `@asteasolutions/zod-to-openapi` so schemas are the **single source of truth** (no drifting hand-written YAML). Register every route with tags, auth scheme, and error responses.

### Task 19.2 — Swagger UI

- Serve at `/api-docs` (disable or protect in production).

### Task 19.3 — Realtime docs

File: `docs/realtime.md`

- The event tables from section 3 plus Mermaid sequence diagrams: matchmaking → game start, move flow, reconnect, game end, analysis ready. (Optional: an AsyncAPI spec.)

### Task 19.4 — README

- Architecture diagram, `docker compose up` quick start, env var table, scripts, links to the ADRs and docs.

**Checkpoint:** someone who has never seen the repo can run it and play a game from the docs alone.

---

## PHASE 20 — Docker, CI/CD, deployment

### Task 20.1 — Dockerfile

- Multi-stage (deps → build → runtime), non-root user, `prisma generate`, Stockfish installed, `HEALTHCHECK`. One image; the container command decides `server` vs `worker`. Add `.dockerignore`.

### Task 20.2 — docker-compose

- Services: `api`, `worker`, `postgres`, `redis`, `mailpit`, optional `nginx`. Healthchecks and `depends_on: condition: service_healthy`. A one-shot `migrate` service that runs `prisma migrate deploy`.

### Task 20.3 — CI (GitHub Actions)

- On PR: install with cache → lint → typecheck → unit tests → integration tests with Postgres/Redis **service containers** → build image → `npm audit` + gitleaks.
- On main: push image to GHCR.

### Task 20.4 — CD

- Deploy `api` and `worker` as two services on Railway / Render / Fly with managed Postgres and Redis. Run `prisma migrate deploy` as a release step. Configure health-check path and env vars. Your Phase 17 shutdown work is what makes deploys zero-downtime-ish.

### Task 20.5 — 12-factor audit

File: `docs/12-factor.md` — table of the twelve factors, status per factor, and the fix for any gap.

### Task 20.6 — Runbook

File: `docs/runbook.md` — how to deploy, roll back, read logs and metrics, and the top failure modes with what to check first.

**Checkpoint:** a push to main runs tests, builds, and deploys; you can roll back from the runbook.

---

## BONUS PHASE (optional — pick any, in any order, only after Phase 20)

### B1 — Extract one microservice (the learning exercise)

- **Candidate: `analysis`.** It is CPU-heavy, asynchronous, already queue-driven, and doesn't need low-latency access to live game state — the seam is already clean.
- Steps: separate entrypoint + image, shared `contracts` package (Zod schemas for job payloads/results), it consumes the `analysis` queue and writes results back (via its own DB access or an internal API), completion signaled through Redis pub/sub or a callback. Observe: deployment complexity, versioning contracts, tracing across services, what got harder.
- **What NOT to extract:** the live game/session/clock logic. Write this up in ADR-005.
- Optional second candidate: `notifications` (email), the easiest seam.

### B2 — Full-text and fuzzy search

- Player search with `pg_trgm` + `tsvector`, GIN indexes, ranked results at `GET /users/search`.

### B3 — Webhooks

- Users/apps register a URL; `game.finished` events are delivered through BullMQ with an **HMAC-SHA256 signature**, timestamp (replay protection), retries with backoff, and a delivery-log table.

### B4 — Object storage

- Avatar upload with presigned URLs (S3/R2/Cloudinary), size/type validation, and a worker job that resizes.

### B5 — In-game chat

- Persistent chat per game, length cap, throttling, a moderation hook, mute/report.

### B6 — Extra chess features

- Takebacks, rematch flow, Chess960.

### B7 — Opening detection

- Import an ECO dataset; map positions (FEN) to opening names; show in analysis summary and stats.

### B8 — Internal domain event bus

- `game.finished` → ratings, analysis, notifications, webhooks as independent subscribers. Decouples `finishGame` from everything downstream.

### B9 — Advanced Postgres (ties directly to your Advanced DB course)

- Partition `Move` (hash by `gameId`), a materialized view for the leaderboard with refresh strategy, a read-replica simulation, `LISTEN/NOTIFY` experiment, look at `VACUUM`/MVCC behavior under heavy updates.

---

## Appendix A — Where each topic you listed is covered

| Topic                                                  | Phase                      |
| ------------------------------------------------------ | -------------------------- |
| Caching                                                | 10                         |
| Task queuing / message queueing                        | 11                         |
| Background jobs                                        | 11, 13                     |
| Full-text search                                       | Bonus B2                   |
| Configuration management                               | 0.2, 20.5                  |
| Logging and observability                              | 14                         |
| Graceful shutdown                                      | 17                         |
| Backend security                                       | 15                         |
| Backend scaling and performance                        | 10, 16                     |
| Concurrency and parallelism                            | 5.5, 8.3, 16               |
| I/O-bound vs CPU-bound                                 | 12.6, 16.3                 |
| Object storage                                         | Bonus B4                   |
| Real-time backends                                     | 5, 6, 7                    |
| The Twelve-Factor App                                  | 20.5                       |
| OpenAPI                                                | 19                         |
| Webhooks                                               | Bonus B3                   |
| DevOps for backends                                    | 17, 20                     |
| Microservices                                          | Bonus B1                   |
| Advanced databases                                     | 8, 9, 16, Bonus B9         |
| System design (Rate limiter chapter, scaling chapters) | Reads alongside 15, 10, 16 |

## Appendix B — How the side tracks fit in

- **OS (OSTEP) and DSA** stay as light weekly tracks. They line up well: processes/signals → Phase 12 and 17, concurrency chapters → Phase 5.5 and 16, scheduling → Phase 11, file systems/persistence → Phase 9.
- **Advanced Databases** (your course) is a light weekly track mapped to: transactions and locking → Phase 8, indexing and query plans → Phase 9, MVCC/vacuum/partitioning → Phase 16 and Bonus B9.
- **System design reading with your friend:** Chapter 1 now, Chapter 3 next, Chapter 4 (rate limiter) when you reach Phase 15, then pick chapters that match the phase you're in.

## Appendix C — Suggested pacing (flexible, not a deadline)

| Block                | Phases | Rough size |
| -------------------- | ------ | ---------- |
| Foundations          | 0–4    | 1–2 weeks  |
| The real-time core   | 5–8    | 2–3 weeks  |
| Data and caching     | 9–10   | 1–2 weeks  |
| Async and engine     | 11–13  | 2–3 weeks  |
| Production-readiness | 14–17  | 2–3 weeks  |
| Tests, docs, ship    | 18–20  | 2 weeks    |

If a phase is dragging, shrink its scope (not its checkpoint) and keep moving. A finished smaller thing beats a perfect half-built thing.
