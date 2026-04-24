# Multi-Connection Behavior — User-Facing Facts

> Pre-seed for user documentation. These facts describe the runtime behavior
> when multiple playgrounds and/or interactive shells are open simultaneously.

## Interactive Shell

- Each shell terminal gets its **own dedicated worker thread**.
- Opening two shells to the same cluster creates two independent workers.
- A slow operation in one shell does **not** block another shell.
- Each shell maintains its own session state (current database, variables, etc.).

## Query Playground

- Playground workers are shared **per cluster** (one worker per unique server).
- Opening multiple playground tabs to the same cluster reuses the same worker.
- A slow operation in one playground **will block** other playgrounds connected
  to the same cluster until it completes. Results are not mixed — requests are
  queued and executed sequentially.
- Connecting to a **different** server creates a separate worker, so playgrounds
  to different clusters run fully independently.
- Each playground document is permanently bound to the cluster and database it
  was created from. There is no "reconnect" or "change connection" flow.

## Why the Difference?

| Aspect              | Interactive Shell        | Query Playground           |
| ------------------- | ------------------------ | -------------------------- |
| Worker granularity   | Per terminal             | Per cluster                |
| Isolation            | Full                     | Per cluster (shared queue) |
| Resource cost        | Higher (one thread each) | Lower (shared per server)  |

The shell uses per-terminal workers because each session can have independent
state (`use <db>`, variables, cursor position). Playgrounds are stateless
evaluations that always specify their target database explicitly, so sharing a
worker per cluster is safe and avoids unnecessary thread overhead.

## Future Consideration

If the shared-worker trade-off proves problematic (e.g., users frequently run
long-running operations in parallel to the same cluster), the architecture
supports switching to per-document workers with minimal changes — the evaluator
pool is keyed by `clusterId` today but could be re-keyed by document URI.
