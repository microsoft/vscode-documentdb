# Optional Context — the CLI idea in more depth

You don't need any of this to help with the [packaging question](../03-where-id-love-your-help.md) — it's the *product shape* behind the tech, shared in case it helps you judge feasibility (e.g. why the daemon exists, why one binary must serve two very different callers).

| File | What it covers |
|---|---|
| [`dual-dx-command-design.md`](./dual-dx-command-design.md) | The central idea: **one tool, two consumers** (human vs agent) with genuinely different needs. How the *same* command surface serves friendly human flags **and** agent-grade structured I/O — the parameter conventions. |
| [`execution-modes.md`](./execution-modes.md) | The three ways the tool hosts a session — **one-shot / REPL / daemon** — over one shared core, and which tools expose which. Explains where the daemon fits and where it's deliberately absent. |
| [`auth-model.md`](./auth-model.md) | How credentials are provisioned **outside** the agent (`documentdb login`, named connections, keychain, scopes) and how the agent works purely with names. |

> These are condensed, standalone summaries of the fuller internal design docs. They intentionally skip most of the *why*/alternatives-considered so they stay readable.
