# Architecture Brief — DocumentDB CLI (big picture)

> Just the shape of the system, no justification. For the reasoning behind each choice, see the optional [`context/`](./context/) folder.

## What it is

A single **command-line tool** for DocumentDB, written in **TypeScript / Node.js**, designed to be used two ways:

- by a **human** at a terminal (interactive), and
- by an **AI agent** (Claude Code, Copilot CLI, etc.) that shells out to it.

The same binary serves both. Agents are taught how to call it via **Skills** (`SKILL.md` files) — we deliberately do **not** ship an MCP server as the foundation.

## The three parts

```
   ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
   │   Human       │        │   AI agent    │        │   Skills      │
   │  (terminal)   │        │  (shells out) │        │  (SKILL.md)   │
   └──────┬───────┘        └──────┬───────┘        └──────┬───────┘
          │ runs                   │ runs                   │ teach the agent
          ▼                        ▼                        │ how to call the CLI
   ┌─────────────────────────────────────────────┐         │
   │            documentdb  (the CLI)              │◄────────┘
   │  one binary, one shared core + session logic  │
   └───────────────┬─────────────────────────────┘
                   │ first call auto-spawns / later calls attach
                   ▼
   ┌─────────────────────────────────────────────┐
   │        daemon  (background process)           │
   │  holds ONE authenticated, warm DB connection  │
   │  reached over local IPC (socket / named pipe) │
   │  idle-timeout → self-exit                      │
   └─────────────────────────────────────────────┘
```

1. **The CLI** (`documentdb`) — the one binary everyone runs. Contains the shared execution core and connection/session logic. Has multiple front-ends over that one core:
   - **one-shot** — run a command and exit.
   - **REPL** — interactive shell; the human logs in and stays warm for the session.
   - **daemon client** — for repeated agent calls; forwards the command to the warm daemon.

2. **The daemon** — a background process the CLI **spawns itself** on first use. It holds a single authenticated, warm DB connection so repeated calls don't re-authenticate. It's reached over **local IPC** (Unix domain socket on macOS/Linux, named pipe on Windows), auto-spawns on first use, and exits after an idle timeout. There is no separate service to install or manage.

3. **Skills** (`SKILL.md`) — text files that teach an agent which commands/flags to use and how to behave (e.g. reference connections by name, never paste secrets into chat). Shipped alongside the CLI.

## How auth is handled — outside the agent's context

The rule: **the agent never sees a credential — not a password, not even a passwordless connection string.**

- A human runs, once, out-of-band:
  ```
  documentdb login prod           # interactive auth; names this connection "prod"
  documentdb login prod --read-only   # optional: scope it; the CLI enforces read-only
  ```
  This authenticates interactively and stores a **durable credential in the OS keychain** under the name `prod`. It survives reboots and idle timeouts.

- From then on, the **agent only ever passes the name**:
  ```
  documentdb query --profile prod "..."
  ```
  The CLI resolves `prod` → the real credential from the keychain **silently**, warms the daemon on demand, and runs. The secret never enters the agent's conversation/context.

- The agent can discover available connections safely:
  ```
  documentdb profiles list        # returns names + scopes only — never secrets
  ```

- If a name isn't provisioned yet, the CLI either prompts the **human** directly on the terminal (bypassing the agent) or returns a clear "run `documentdb login prod`" message. It never asks the agent for the secret.

**Net:** provisioning is a deliberate human action outside the agent; the agent works purely with **names** (scoped capabilities); the warm daemon makes repeated calls cheap. One binary, self-spawned daemon, Skills for the agent, keychain-backed named connections for auth.
