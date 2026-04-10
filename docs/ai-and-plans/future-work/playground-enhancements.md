# Future Work: Query Playground Enhancements

> Improvements to the Query Playground (`.documentdb` files) that were deferred during the initial implementation.

---

## Persistent Eval Context

**Priority:** P1 | **Impact:** High | **Effort:** 2–3 days

Optional mode where JavaScript variables persist across runs. `const x = 1` in one execution is available in the next. Currently each playground run starts with a fresh context.

The infrastructure already exists — the Interactive Shell uses `persistent: true` on `DocumentDBShellRuntime`. The playground could offer a toggle between fresh and persistent modes.

---

## Per-File Connections

**Priority:** P2 | **Impact:** Medium | **Effort:** 2 days

Each playground file remembers its own `{clusterId, databaseName}` pair. Multiple playgrounds connected to different databases can work simultaneously.

Currently all playground files share a single global connection. The `PlaygroundService` singleton would need a `Map<URI, PlaygroundConnection>` instead of a single state.

---

## WebView Output Panel

**Priority:** P2 | **Impact:** Medium-High | **Effort:** 3–5 days

Replace the virtual read-only document output with a rich webview panel:

- Syntax-highlighted JSON with folding
- Tabular/grid view toggle
- Copy individual documents
- Pagination controls
- Execution time display

---

## Connection Persistence Across Restarts

**Priority:** P2 | **Impact:** Medium | **Effort:** 1 day

Store last-used playground connection in `globalState` so reconnection is automatic on VS Code restart.

---

## Smart Connection QuickPick

**Priority:** P3 | **Impact:** Low-Medium | **Effort:** 1 day

Replace the CodeLens instruction dialog with a QuickPick-based database selector showing available clusters and databases inline.

---

## Collection-Aware Templates

**Priority:** P3 | **Impact:** Low-Medium | **Effort:** 1 day

Pre-populate new playground files with templated queries using known field names from `SchemaStore`. Right-click `orders` → New Playground → file opens with `db.orders.find({ _id: , status: , total: })` pre-filled.

---

## Structure-Aware Block Detection

**Priority:** P3 | **Impact:** Low | **Effort:** 1 day

Upgrade from blank-line block detection to bracket-aware detection that tracks `()`, `[]`, `{}` nesting depth. This was evaluated during Step 7.2 and deferred — the blank-line convention is simple and teachable, and the Interactive Shell uses a different input model.

---

## PlaygroundDiagnostics Expansion

**Priority:** P3 | **Impact:** Low | **Effort:** 0.5 day

The diagnostic provider currently warns about `.limit(N)` exceeding batch size. Future diagnostics could include:

- Deprecated operator usage warnings
- Missing index hints based on query explain output
- Unsupported DocumentDB API features
