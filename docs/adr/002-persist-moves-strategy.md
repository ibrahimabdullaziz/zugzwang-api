# ADR 002: Persist moves immediately to PostgreSQL

- Status: Accepted
- Date: 2026-10-14

## Context

Chess moves are low-volume compared to the throughput that PostgreSQL can comfortably handle. A live game produces roughly one move every few seconds, which means even with 1,000 concurrent active games the write volume stays in the low hundreds of inserts per second.

At that scale, a single-row insert per move is simple, safe, and operationally predictable. The application must preserve every confirmed move even if the API process crashes or a Redis instance fails. Since the move stream is the authoritative record of a game, the system should not rely on an in-memory buffer that could lose accepted moves.

In this architecture, PostgreSQL is the durable source of truth for game history and move data, while Redis may still be used for transient live-state or fan-out concerns. Persisting each move as soon as it is validated keeps the model easy to reason about and removes a large class of data-loss failure modes.

## Decision

We choose to persist each chess move immediately to PostgreSQL upon receiving and validating it.

This means:

- each accepted move is inserted immediately into the `Move` table;
- the game record is updated in the same transaction when the move is persisted;
- a move is not held in an application buffer before it is recorded;
- a crash or restart cannot silently drop a confirmed move.

## Rationale

This matches the project goals around correctness and durability:

1. Human-speed chess traffic is small enough that immediate writes are not a bottleneck.
2. Postgres handles indexed single-row inserts well, even at moderate concurrency.
3. The system is simpler to debug because every accepted move is immediately durable.
4. The risk of losing move history is significantly lower than with a write-buffered design.

## Consequences

### Benefits

- stronger durability guarantees;
- simpler failure recovery;
- easier auditing and replay of game histories;
- less operational complexity than a queue-based write-behind system.

### Trade-offs

- writes are synchronous and directly hit the database;
- the API path has a little more DB latency per move;
- if traffic grows dramatically, a more advanced buffering strategy may be considered.

## What we would change if write load becomes a bottleneck

If write throughput becomes a real bottleneck, we would move to a staged architecture such as:

- an in-memory or Redis append-only buffer for active-game move events;
- a worker queue (for example BullMQ) to flush move batches asynchronously;
- periodic or event-driven flushes to PostgreSQL;
- eventual persistence of the full game state and PGN at the end of the game.

That approach would reduce write pressure on PostgreSQL, but it would also introduce a durability window where accepted moves may be lost if the process fails before the flush completes. We would only adopt it after measuring real traffic and confirming that the simpler immediate-write approach is a bottleneck in production.

## Summary

For the current scale and requirements, immediate persistence is the safest and most maintainable choice. It preserves move history without adding hidden failure modes, and it keeps the application logic transparent and easy to validate.
