# Execution Modes & Session Hosting

The tool hosts an authenticated session in one of **three** ways. All three run over **one shared core + session logic** — they differ only in the front-end (where input/output flows). Each tool declares which host(s) it exposes.

## The three hosts

| Host | Who drives | Where the warm session lives | Warmth |
|---|---|---|---|
| **One-shot** | anyone | nowhere — authenticate, run, exit | none (by design) |
| **REPL (foreground)** | a human at a terminal | **the interactive process itself** | free — the process *is* the session |
| **Daemon (detached)** | stateless client calls (agents / scripts) | a background process reached over local IPC | amortized across many calls |

Key idea: **humans get warmth for free from the foreground REPL; agents get it from the daemon.** Same benefit, two hosting mechanisms — because a human stays attached to a live process and an agent doesn't. The daemon is therefore an *agent* affordance, not a general one.

## Why REPL and daemon are the *same* loop (and cost us almost nothing extra)

Strip a REPL to its essence:

```
authenticate() → session
loop { cmd = read <input>; result = core.execute(session, cmd); write result to <output> }
```

A daemon is the **identical loop** — only `<input>`/`<output>` change:
- **REPL:** input = terminal lines, output = terminal
- **Daemon:** input = messages on a local socket, output = socket replies

So it's **one session-host loop with a pluggable front-end**, not two implementations (this is exactly the LSP / language-server insight). Offering "both ways" for a tool like the shell costs one thin adapter, not a second codebase.

## The layers

```
Layer 1  Core / execution engine   core.execute(session, cmd) → result   (no I/O of its own)
Layer 2  Session                    auth + live connection + stateful context (current db, vars)
Layer 3  Host (the loop)            authenticate once → hold session → dispatch input→core→output
            ├── front-end: TTY / REPL     (human)
            ├── front-end: socket / daemon (agent clients) + a thin client that forwards
            └── front-end: one-shot        (auth, single execute, exit)
```

Layers 1–2 are written once and shared by every host.

## Per-tool opt-in (examples)

| Tool | one-shot | REPL | daemon |
|---|---|---|---|
| **connectivity troubleshooter** | ✅ (only) | — | — |
| **documentdb shell** | ✅ | ✅ | ✅ |

- The **troubleshooter** is deliberately one-shot with **fresh auth every time** — for a diagnostic, re-establishing the connection *is the thing being tested*, so warmth would be wrong (it'd hide the failures the tool exists to find).
- The **shell** exposes all three: `documentdb shell` (REPL, human), repeated `documentdb query …` from an agent (daemon, auto-spawned on first call), and `--no-keep-alive` (one-shot).

## Credential strategy follows the host (the TTY rule)

- **TTY present** (REPL, or a human-run one-shot) → **may prompt interactively** (hidden input); the secret lives only in memory.
- **No TTY** (daemon, or an agent-run call) → **must resolve credentials non-interactively** (name → keychain) and fail cleanly if it can't. A daemon is headless — it can't prompt.

The daemon and an MCP server (if we ever add one) are the **same headless case**, so they share one non-interactive resolver; only the human REPL adds the interactive-prompt branch. See [`auth-model.md`](./auth-model.md).

## Relevance to the packaging mission

The **daemon front-end is why packaging matters**: whatever we use to ship the binary must let the tool **spawn a detached copy of itself** and talk to it over a Unix socket / named pipe. That's the compatibility check called out in [where I'd love your help](../03-where-id-love-your-help.md).
