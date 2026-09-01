# Auth Model — credentials provisioned outside the agent

The single rule: **the agent never sees a credential — not a password, not even a passwordless connection string.** The agent works only with **names**.

## `documentdb login` — provision once, out-of-band

A human runs, at their own terminal, outside any agent:

```bash
documentdb login prod                 # interactive auth; name this connection "prod"
documentdb login prod --read-only     # optional: scope it (enforced by the CLI/daemon)
```

This:
- authenticates **interactively** (hidden prompt / browser / device code — whatever the auth type needs),
- stores a **durable, refreshable credential in the OS keychain** under the name `prod`,
- survives reboots and idle timeouts (it's the profile; the warm daemon is separate and ephemeral).

## From then on, the agent uses only the name

```bash
documentdb query --profile prod "..."     # CLI resolves "prod" → secret from keychain, silently
documentdb profiles list                  # returns names + scopes only — never secrets
```

The CLI resolves the name to the real credential **inside its own process**, warms the daemon on demand, and runs. The secret never enters the agent's conversation or context.

## Why names even for passwordless / Entra ID auth

Even when a connection carries **no password** (Entra ID, managed identity, etc.), we still don't hand the agent a raw connection string — a DSN leaks topology/tenant/account identifiers and is an injection/exfiltration surface. So: **the agent always gets a name, never a string.** For token-based auth we store a *refreshable* credential so the daemon renews silently (never a frozen token).

## Scope is set at login (least-privilege by construction)

Because provisioning is a deliberate human gesture outside the agent, `login` is where a permission boundary is attached to the named connection — most importantly **read-only**. The scope is bound to the profile and **enforced by our CLI/daemon on every command**, not by trusting the agent. An agent wielding a `--read-only` profile **physically cannot write**, whatever it's prompted or injected to do.

## Containment property

The agent can only pass **names**, and names resolve only to connections a human already provisioned and scoped. So a confused or prompt-injected agent **cannot invent a new target, cannot supply a raw connection string, and cannot exceed the profile's scope.** It can at most use what you already authorized, the way you authorized it. (Therefore the agent is given name-referencing commands and a read-only `profiles list` — never a `login`/connect-with-a-string capability.)

## What happens if a name isn't provisioned yet

1. **Provisioned** → resolve silently, warm the daemon, run. *(happy path)*
2. **Not provisioned, but a terminal is attached** → the CLI prompts **the human** directly on the terminal (writing to `/dev/tty`, bypassing the agent's captured stdin) — the way `ssh`/`sudo`/`git` prompt from scripts. The secret goes keyboard → CLI, never through the agent.
3. **Not provisioned, no terminal** → return a structured, human-readable error the agent relays: *"run `documentdb login prod` in your terminal, then ask again."*

## The Skill rule that keeps this safe

The `SKILL.md` instructs the agent: **never ask the user to paste a connection string or password into the conversation.** Reference connections by name; on a missing-credential error, tell the user to run `documentdb login <name>` in their terminal.

## Honest boundary

Keychain resolution is non-interactive by design (that's what makes a name "just work" for the agent). That prevents the secret from entering the **model's context** — but it does not stop a same-user agent process from invoking `documentdb` itself. That's acceptable for the normal case (the agent acts as you), and `--read-only` narrows the blast radius. Preventing the agent's *process* from using the connection at all would require a human-gesture-gated release or a broker running as a different OS user — an explicit future option, not the default.
