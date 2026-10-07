## Who owns a live game's in-memory state when there are multiple API instances?

**Decision:** Live game state is owned by a shared Redis instance rather than by any individual API instance.

With multiple API instances running behind a load balancer, any instance must be able to read and update the state of any active game. Storing game state in process memory would make the state instance-specific and could lead to inconsistent games when subsequent requests are routed to a different instance.

Redis will serve as the shared source of truth for active games, while the database will be used for persistent game data such as completed games and move history.

This also allows the application to scale horizontally without requiring session or game-state affinity between clients and API instances.

## Persist every move immediately vs buffer in memory/Redis and flush?

**Decision:** Persist every valid move immediately to the database.

Each accepted move will update the live game state in Redis and be persisted to PostgreSQL as part of the same move-processing flow. Redis is responsible for the active game's state, while PostgreSQL provides durable game and move history.

We will not buffer moves for periodic flushing because this introduces a window where accepted moves could be lost if the application or Redis fails before the buffer is persisted. The expected game volume does not justify accepting this durability risk.

Batching or asynchronous persistence can be introduced later as a performance optimization if database write throughput becomes an actual bottleneck.

## Clock design: what is the source of truth and how do we avoid drift?

**Decision:** The server-side game state in Redis is the source of truth for chess clocks.

We will store each player's remaining time along with the current turn and the server timestamp at which the turn started. The server will calculate elapsed time when processing moves rather than continuously decrementing a counter.

The client will use the server-provided timestamps to render a smooth local countdown, but it will not be authoritative. Game state updates and server timestamps will allow the client to resynchronize and correct any local drift.

Timeouts will be determined server-side when processing moves or other authoritative game events. A client reaching zero locally does not by itself end the game.

This approach avoids relying on browser timers, client clocks, or network timing for game correctness while still providing a smooth countdown UI.

## Module boundaries and what each module may depend on

## When is it worth extracting a service? (used in Bonus)
