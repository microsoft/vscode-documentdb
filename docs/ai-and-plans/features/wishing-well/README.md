---
feature: wishing-well
kind: overview
status: planned
created: 2026-11-23
code:
  - src/services/wishingWell/**
  - src/webviews/documentdb/wishingWell/**
  - src/commands/openWishingWell/**
  - src/documentdb/shell/shellWish.ts
---

# Wishing Well (side project)

A fun side project, not on the roadmap and not an official feature. It exists to try out how
far one free-text box can reach into the extension's own tools, and how agents outside VS Code
could use them.

A wish is read by Copilot (or matched by keywords without it) and turned into one action: a
read-only query, the collection view with a query, the shell, a playground, the dashboard,
import or export, diagnostics, an allowlisted VS Code command, or a hand-off to Copilot agent
mode. "I'm feeling lucky" draws a random document, trivia, a tip or a fortune.

The same well is reachable from the tab, from `wish …` in the interactive shell, from Copilot
agent mode as language-model tools, and from any MCP client through a local endpoint the user
turns on.

Rules the code keeps:

- Wishes never write data. Changes come back as a playground script the user runs.
- Read-only queries run when the wish is made; everything else waits for a grant.
- Only allowlisted VS Code commands run. Anything else goes to Copilot agent mode.
- The MCP endpoint listens on 127.0.0.1 only, needs a bearer token and rejects browser origins.
- Telemetry records the kind of action, never the wish text.

Screenshots of the demo are in [images/](images/).
