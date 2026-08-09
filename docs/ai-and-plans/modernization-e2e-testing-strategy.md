# E2E & Visual Testing Strategy

**Research date:** 2026-08-09
**Companion to:** [`modernization-build-and-test-stack.md`](./modernization-build-and-test-stack.md)
**Subjects:** `microsoft/vscode-cosmosdb` `test/e2e/` (main @ `4b1bb6c`) vs. our parked
[PR #867 — Webview visual harness + Playwright suite](https://github.com/microsoft/vscode-documentdb/pull/867)

---

## 0. The question this document answers

> **Status:** the recommendation in Part 5 was revised after review. An earlier draft argued for
> building E2E _before_ the migration; the reference project's own timeline disproved that. See
> Part 5 and the Decision Log in the
> [companion document](./modernization-build-and-test-stack.md#decision-log).

> _"I assume #867 is more for quick checks during dev for agents, but maybe the E2E from
> vscode-cosmosdb has already this built in somehow."_

**Short answer: no, it does not — and the two are not competing.** They answer different
questions, and Cosmos DB solves "get the UI into a specific state" by a fundamentally different
mechanism (real backend + test-only commands) than #867 does (stubbed host + canned fixtures).

Each has a capability the other structurally cannot provide:

- Cosmos DB's suite can prove **"this works inside real VS Code"**. #867 can never prove that — it
  says so itself.
- #867 can reach **failure and edge states in milliseconds** with no Docker and no host. Cosmos
  DB's suite structurally cannot do that cheaply, because its states come from a real emulator.

The correct end state is **both**, plus the Extension Host layer. Details in Part 5.

---

## 1. What Cosmos DB actually built

### 1.1 It grew far beyond the original PR

The migration PR (#3136, June 2026) landed just **two** specs: a smoke test and one
emulator-connected test. That is not what exists today.

Current `test/e2e/specs/` — **21 spec files**:

```
smoke.spec.ts                       emulator-connected.spec.ts
migration.spec.ts                   queryEditor-open.spec.ts
queryEditor-crud.spec.ts            queryEditor-paging.spec.ts
queryEditor-history.spec.ts         queryEditor-errors.spec.ts
queryEditor-cancel.spec.ts          queryEditor-hotkeys.spec.ts
queryEditor-selection.spec.ts       queryEditor-selection-run.spec.ts
queryEditor-column-resize.spec.ts   queryEditor-duplicate-tab.spec.ts
queryEditor-result-views.spec.ts    queryEditor-result-toolbar-stats.spec.ts
queryEditor-toolbar-overflow.spec.ts queryEditor-query-toolbar.spec.ts
queryEditor-tree-open.spec.ts       query-editor-toolbar.spec.ts
```

The trajectory matters more than the count: they started with a smoke test as the safety net for
the Vite migration, then grew a _feature-level_ suite on top of the same scaffold. The scaffold was
the investment; the specs are cheap afterwards.

Note also their README's own provenance: the scaffold was **borrowed from a sibling
`[Ref1]` project's `test/e2e/`**, keeping the patterns that paid off and skipping the
rest. There is a third internal reference implementation worth knowing about.

### 1.2 Architecture

```
Playwright
    │  _electron.launch({ executablePath: <downloaded VS Code> })
    ▼
Real VS Code (Electron)
    │  --extensionDevelopmentPath=dist/        → the extension under test
    │  --extensions-dir=.vscode-test/e2e-extensions  → dependent extensions
    │  --user-data-dir=<worker-scoped temp dir, pre-seeded settings.json>
    │  <worker-scoped workspace dir>
    ▼
Spec opens the command palette → runs a command → finds the webview iframe
by predicate → asserts the React tree mounted → closes all tabs in afterEach
```

Their stated reason for real VS Code over Chromium is worth quoting, because it is exactly the
boundary #867 declines to cross:

> "The webview runtime VS Code provides is **not just a browser** — it includes the
> `acquireVsCodeApi()` global, a custom CSP, `--vscode-*` CSS variables, the `l10n_bundle`
> injection, the postMessage transport, and the Electron version that ships with the editor.
> Faking all of that in plain Chromium is brittle and never quite right."

### 1.3 The mechanisms worth studying

| Mechanism                        | File                                                      | What it solves                                                                                                                                                                                                                                                            |
| -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Worker-scoped fixtures**       | `fixtures/vscode.ts`                                      | `vscodeApp`/`vscodeWindow` use `{ scope: 'worker' }`, so VS Code launches **once per worker**. Their README: a 10-test file would pay ~50s of startup naively, ~5s with worker scope. The trade-off: every test must reset state in `afterEach` via `closeAllEditorTabs`. |
| **Test-only extension commands** | `src/commands/e2eTestCommands/registerE2eTestCommands.ts` | `cosmosDB.e2e.*` commands registered **only** when `COSMOSDB_E2E_TEST === '1'`, with a matching `cosmosDB.e2eTestMode` context key gating palette visibility. Without the flag the commands are not registered at all. This is their answer to "reach a state quickly".   |
| **Console health gate**          | `fixtures/consoleHealth.ts`                               | Listens to `console.*` from the `vscode-webview://` origin only (so workbench noise cannot trip it) and **fails the test on `console.error`** unless allow-listed. Their allowlist is deliberately **empty**, with a comment that an empty list is the goal.              |
| **Activation handshake**         | `setup/activation.ts`                                     | Before any spec runs, opens the Azure sidebar and waits for a known tree node — proving both the dependency extension _and_ their own finished activating. Eliminates a whole class of flake.                                                                             |
| **Run isolation**                | `helpers/e2eIsolation.ts`                                 | `runId` + run-scoped temp/results/reports dirs, so parallel workers and repeat runs never collide.                                                                                                                                                                        |
| **Build staleness + mode guard** | `setup/globalSetup.ts`                                    | Auto-runs `vite-prod` when `dist/` is older than `src/`. After PR #3164 it also writes a `dist/.e2e-prod-build` marker, because a _dev_ watch build looked newer-by-mtime yet broke rendering. Freshness had to encode build **mode**, not just time.                     |
| **Capture modes**                | `helpers/captureMode.ts`                                  | Playwright's declarative `use.screenshot`/`use.trace` do **not** apply to a manually launched Electron app, so they capture screenshots and traces themselves, gated by `COSMOSDB_E2E_SCREENSHOT` (`off` / `on` / `only-on-failure` / `trace` / `trace-on-failure`).      |
| **Coverage from E2E**            | `fixtures/coverage.ts`, `setup/aggregateCoverage.ts`      | `npm run e2e:coverage` collects JS coverage from the webview during real E2E runs and aggregates it.                                                                                                                                                                      |
| **Isolated backend**             | `docker-compose.e2e.yml`                                  | Separate compose project (`cosmosdb-e2e`, ports 8082/1235) so it never touches a developer's own emulator on 8081. No volumes — every run starts pristine.                                                                                                                |
| **Window layout control**        | `helpers/windowLayout.ts`                                 | Per-test sidebar/panel visibility, so layout-sensitive assertions are deterministic.                                                                                                                                                                                      |

### 1.4 CI

- Dedicated `.github/workflows/e2e.yml` on Linux.
- `xvfb-run` is **mandatory**: Electron has no headless mode — every `_electron.launch()` opens a
  real OS window. Their README calls this out explicitly; there is no `e2e:headed` script because
  there is no headless mode to opt out of.
- `npx playwright install-deps chromium` installs the shared GTK/NSS libs Electron needs (not the
  browser itself).
- On failure: HTML report, traces/videos, and `docker logs` of the emulator are uploaded.
- Each workflow maintains **its own PR comment** via a stable HTML-comment marker, after their
  earlier "main polls siblings" design proved fragile.

---

## 2. What PR #867 actually is

### 2.1 Architecture

`test/webview-harness/` renders a **real production webview bundle in a plain browser**:

- stubs exactly **one** global: `acquireVsCodeApi()`
- serves `dist/` as the site root, because the harness `import()`s `./views.js` as an ES module
- answers tRPC calls with canned fixtures selected by `?scenario=...`, themed by `?theme=dark|light`
- records escaping actions (`common.openUrl`, `localQuickStart.copyConnectionString`,
  `localQuickStart.openConnection`) onto `window.__harnessCalls` instead of performing them

Everything below that single stub is the shipped code: real React tree, real Fluent styling, real
DOM, real localization lookup.

### 2.2 Its declared non-scope (this is the honest part)

- **not** the VS Code webview host: no CSP, no panel chrome, no real message bus
- theme values are a representative slice of Dark/Light Modern, not live values
- **zero** host-side behaviour: no Docker probes, no provisioning, no storage
- screenshots are **artifacts, not baselines** — deliberately, because OS-rendered text makes pixel
  baselines fail across machines for reasons unrelated to the UI

### 2.3 The agent angle

This is the part the PR itself calls "most of the value":

> "Point browser tools at the running harness: `read_page` for the accessibility tree,
> `screenshot_page`, `click_element`, and `run_playwright_code` for measurements and for reading
> `window.__harnessCalls`. An agent can reach a state that otherwise needs a human, Docker, and
> several minutes."

### 2.4 Why it was parked — and whether that still holds

| Stated reason                                                                                  | Still true?                                                                      |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| "webpack is going away — the harness's whole premise is `dist/views.js` from `webpack-dev-wv`" | **Yes**, and confirmed: the migration analysis recommends Vite.                  |
| "the test story is being redone; adding a second runner before that lands fragments it"        | **Yes** — and it argues for unparking only once the new stack and Layer C exist. |
| "the wire protocol it hand-stubs is moving into `@microsoft/vscode-ext-webview`"               | **Yes** — and this turns out to be the _fix_, not just a blocker. See Part 4.    |

The parking decision was correct. But every reason given was about **timing**, not value — and the
timing is precisely what is now being resolved.

### 2.5 Known debts the PR documents against itself

- **Fixture drift.** Fixtures were written against a pre-review router shape and have already
  drifted (`willReuse` → `canReuseExistingData`; `suggestedPort`, `checkPort`, `onInstanceChanged`
  missing). All degrade _harmlessly_ — "which is precisely the risk: it will drift into fiction
  while still looking green."
- **Untyped fixtures.** Scenarios are untyped JS object literals inside the HTML, with nothing
  tying them to the router's real output types. That is _how_ the drift happened silently.
- **Dependency smell.** `@playwright/test` pinned to a caret-ranged alpha
  (`^1.63.0-alpha-2026-07-29`) resolving from an ADO mirror with sha1 integrity hashes.
- **Two runners, neither aware of the other.** Jest's `testMatch` never sees `test/**/*.spec.ts`;
  Playwright's `testDir` never sees `src/`. "I ran the tests" becomes ambiguous.
- **Unresolved:** CI-wired or explicitly manual? Unwired, a visual suite rots into fake coverage.

---

## 3. Head-to-head

| Dimension                                     | Cosmos DB E2E                                               | PR #867 harness                                         |
| --------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- | -------------------------- |
| **Runtime**                                   | Real VS Code (Electron), real webview host                  | Plain browser (Chromium via Playwright)                 |
| **What it proves**                            | The product works end to end                                | The React UI renders and behaves correctly given inputs |
| **CSP / `acquireVsCodeApi` / `l10n_bundle`**  | Real                                                        | Absent / single stub                                    |
| **Host behaviour**                            | Real (storage, connections, commands)                       | None — by design                                        |
| **Backend**                                   | Real Cosmos DB emulator in Docker                           | Canned fixtures                                         |
| **Startup cost**                              | VS Code launch + Docker (~5s/worker after warm; xvfb on CI) | Page load (sub-second)                                  |
| **Reaching an error/edge state**              | Must be produced for real, or via a test-only command       | `?scenario=...` — instant, arbitrary                    |
| **Theme matrix**                              | Whatever VS Code is running                                 | `?theme=dark                                            | light`, switchable per URL |
| **Screenshots**                               | Self-managed, gated by env; failure artifacts               | Artifacts, explicitly not baselines                     |
| **Agent-drivable**                            | Awkward (Electron window, needs Docker)                     | Excellent — the stated purpose                          |
| **Catches "blank webview in packaged build"** | **Yes**                                                     | **No**                                                  |
| **Catches "Monaco worker fails under CSP"**   | **Yes**                                                     | **No**                                                  |
| **Catches "button opens the wrong URL"**      | Yes, but expensively                                        | **Yes, cheaply** (`window.__harnessCalls`)              |
| **Catches Docker-failure UI states**          | Very hard                                                   | **Easy**                                                |

### The key asymmetry

Cosmos DB's answer to _"how do I get the Query Editor into state X?"_ is **`cosmosDB.e2e.*`
test-only commands plus a seeded emulator** — build the state for real, then look at it.

#867's answer is **swap the fixture** — describe the state, skip the machinery.

Neither generalises to the other:

- Real-state construction cannot cheaply produce _failure_ states. "Docker daemon not running",
  "image pull failed", "port already bound", "network timeout" are all trivial fixtures and
  genuinely painful to orchestrate against a live emulator.
- Fixture stubs cannot prove anything about CSP, worker construction, asset URLs, or packaging —
  which is the exact class of bug the migration is most likely to introduce.

---

## 4. The migration improves #867 rather than obsoleting it

Three of the harness's documented problems are _fixed by the very changes that parked it_:

**1. The `writeToDisk` hack disappears.** The PR's "number one time waster" was stale
`dist/views.js`, because `watch:views` is `webpack serve` and builds in memory — requiring
`devServer.devMiddleware.writeToDisk`. Vite's dev server serves modules over HTTP natively; the
harness page can be served by `vite serve` directly, with HMR, and the whole failure mode is gone.

**2. Typed fixtures become possible — this kills the drift risk.** Once the tRPC plumbing lives in
`@microsoft/vscode-ext-webview`, the harness can stop hand-rolling `{id, op:{type, path, input}}`
and instead type its scenarios against the router's actual inferred output types. A router change
then breaks the fixture **at compile time** instead of silently degrading into fiction. This is the
single most important fix, because it converts the harness's worst property into a checked one.

**3. Vitest + jsdom absorbs part of the job.** Cosmos DB's PR #3172 added React component tests with
Testing Library under Vitest. Pure component logic tested there is cheaper than a browser harness.
The harness should then focus on what jsdom cannot do: **real layout, real Fluent styling, real
theme variables, screenshots**.

---

## 5. Ref1 — the older, larger sibling

> **Ref1** is another internal VS Code database extension with a mature Playwright E2E system.
> Its architecture report was shared for this analysis. The project name, repository URLs and
> internal PR numbers are deliberately redacted here; where a quotation would reveal the name it is
> replaced with `[Ref1]`.

### 5.1 Cosmos DB is a documented subset of Ref1, not an independent design

This is settled by Cosmos DB's own public E2E README:

> "The scaffold borrows heavily from the sibling `[Ref1]` project's `test/e2e/` setup. We kept the
> patterns that pay off immediately and **skipped the ones we don't yet need (multi-editor adapter,
> reusable auth profile, @tag-based grep filtering, JUnit reporter)**."

So the question is not "which approach is better". It is **"how much of Ref1 do you need yet?"**
Cosmos DB answered that question once already, in writing, and later partially reversed one of the
four omissions (JUnit output was added for one of their workflows).

**Maturity gap:**

|              | Ref1                                                               | Cosmos DB     |
| ------------ | ------------------------------------------------------------------ | ------------- |
| E2E started  | Feb 2026                                                           | Jun 2026      |
| Initial size | 78 tests                                                           | 2 specs       |
| Current size | ~294 runnable, ~58 smoke                                           | 21 spec files |
| Editors      | VS Code **and** Cursor                                             | VS Code       |
| Parallelism  | Per-worker cloned databases; 4 shards × 2 editors nightly          | 1 worker      |
| Backend      | 6 services (5 Postgres variants + SSH jumphost), SSL/SSH artifacts | 1 emulator    |

Ref1 is roughly four months and an order of magnitude ahead. That is context, not criticism of
either: Cosmos DB deliberately took an MVP slice.

### 5.2 What Ref1 has that Cosmos DB does not

| Capability                                                                                                                                                               | Why it matters to us                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Installed-VSIX lane** (`*_E2E_INSTALLED_VSIX`) — installs a packaged VSIX into a test-scoped extensions dir and tests **that** instead of `--extensionDevelopmentPath` | **The single most relevant item in the whole report.** It automates exactly the dev-vs-packaged gap that let Cosmos DB's blank-webview bug survive 18 days, and that our Phase 0 checklist currently covers by hand |
| **Component-screenshots project** — isolated React scenarios captured without the full backend; scenario ownership in `dev/`, test code is only a capture adapter        | Independent convergence on PR #867's idea, with a cleaner ownership split. See §5.5                                                                                                                                 |
| **Convention scanner** (`check-e2e-conventions.mjs`)                                                                                                                     | Machine-enforces the E2E rules. High value when tests are written by agents                                                                                                                                         |
| **Capability tags** (`@smoke`, `@requires-db`, `@requires-ssl`, `@release-core`, …) driving CI lane selection                                                            | Lets one suite serve PR smoke, nightly full, and release validation                                                                                                                                                 |
| **Seeded workspace fixture** with a real `restartVsCode()`                                                                                                               | Tests settings-scope precedence and restart persistence — directly relevant to our connection storage and settings scopes                                                                                           |
| **Editor adapter** (VS Code + Cursor)                                                                                                                                    | Not needed today, but the right shape if we ever target another editor                                                                                                                                              |
| **Seed sentinel** — poll a `_e2e_seed_complete` marker rather than DB health                                                                                             | Avoids racing the tail of seeding (grants, policies, ANALYZE)                                                                                                                                                       |
| **Compose project as teardown source of truth**                                                                                                                          | Cleans only this run's resources; never sweeps a developer's containers                                                                                                                                             |
| **Fail-loud CI** — use the CI system's own step outcome, not a shell-written exit code                                                                                   | They shipped a bug where a timed-out E2E step reported success                                                                                                                                                      |
| **Nightly issue lifecycle** — open on failure, auto-close on recovery, and failing to notify is itself a failure                                                         | Prevents silent rot                                                                                                                                                                                                 |
| **Rich helper diagnostics** — rejected candidates, CSS state, overflow contents                                                                                          | "Locator not found" is useless in virtualized editor UI                                                                                                                                                             |

### 5.3 What Cosmos DB has that Ref1's report does not mention

Absence from a report is not absence from a repository, so treat these as "not evidenced" rather
than "missing":

- **`consoleHealth`** — failing a test on any `console.error` originating from the webview origin.
- **E2E coverage collection** and aggregation.
- **Build staleness detection with a production-build marker.**
- **A single env knob for screenshot/trace capture modes.**

### 5.4 Where they converged independently — the strongest signal

Both projects landed on the same answers, and the naming similarity confirms the lineage
(`<ext>.e2eTestMode` / `<EXT>_E2E_TEST=1` vs `cosmosDB.e2eTestMode` / `COSMOSDB_E2E_TEST=1`):

- Playwright driving a **real Electron editor**, not mocked Chromium
- **Worker-scoped** editor fixtures, with per-test state reset
- **Run-scoped isolation** of user-data, extensions, workspace, results and reports
- **Test-only commands gated by an env var _and_ a context key**
- An **activation handshake** before any spec runs
- An **isolated Docker project** for the backend
- **Native dialog interception** at the Electron layer
- **Observable readiness over sleeps**
- **`afterEach` cleanup** of tabs and connections

When the mature original and the pragmatic subset independently agree, treat the pattern as settled
practice rather than a preference.

### 5.5 Ref1 validates PR #867 — and offers a better home for it

Ref1 runs **three** distinct Playwright uses, not one:

| Project                   | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| Main E2E                  | Behavioural regression against real editor + real database             |
| Docs screenshots          | Deterministic documentation PNGs; own config; excluded from regression |
| **Component screenshots** | **Isolated React scenarios captured without the full backend**         |

That third project is PR #867's concept, arrived at independently — which is strong evidence the
idea is sound rather than a workaround. Two details are worth copying outright:

1. **Scenario ownership lives in `dev/`, not in the test folder.** Test code is "only a capture
   adapter". This directly addresses #867's worst flaw — fixtures drifting into fiction — because
   the scenarios sit next to the components they describe rather than in an HTML file.
2. **Their own warning:** these "should not become a substitute for full E2E tests". Same conclusion
   this document reached in Part 3.

### 5.6 Costs and cautions, from Ref1's own risk list

Ref1 is candid about what its approach costs — worth reading before copying it wholesale:

- **Test-mode UI divergence.** Their test-only inline buttons change the tree UI while E2E mode is
  on, and ordinary row clicks or drag coordinates can accidentally hit them. The seam has a blast
  radius.
- **Production code carries E2E-gated behaviour.** Test-only commands, skipped confirmations,
  injected tokens, a mock auth provider. Defensible and double-gated, but a real trade-off some
  teams would reject outright.
- **Retry masking.** CI retries plus nightly retries can hide genuine regressions when assertions
  are weak.
- **Scale cost.** ~294 tests × 2 editors × 4 shards needs long timeouts, image caching and
  build-once distribution.
- **Native menus remain unsolved.** After trying `Menu.prototype.popup` interception, native
  `MenuItem.click()`, keyboard navigation and IPC bridging, they concluded native context menus are
  not a reliable command path at all.
- **Documentation drift.** Their README still says "only setup to run locally" despite extensive CI.

### 5.7 What we should take, and what we should not

| Take now                                                                                                                                                                            | Take later                                                                                             | Skip                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installed-VSIX lane; capability tags + smoke/nightly split; convention scanner; fail-loud CI; compose-project teardown; seed sentinel (we already use Docker for Local Quick Start) | Seeded workspace fixture + restart boundary; component-screenshots home for #867; per-worker isolation | Multi-editor adapter (we do not target Cursor); per-worker DB cloning and sharding (premature at our size); Entra/Azure provisioning lanes (not applicable) |

---

## 6. Recommendation: three layers, clear boundaries

| Layer                                                     | Runtime                     | Answers                                                                            | Cost            | Status                                          |
| --------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------- | --------------- | ----------------------------------------------- |
| **A. Component tests** (Vitest + jsdom + Testing Library) | Node + jsdom                | "Does this component behave?"                                                      | ms              | New — comes free with Vitest                    |
| **B. Visual harness** (#867, rebuilt)                     | Browser, stubbed host       | "Does the UI render correctly in this state, including failure states and themes?" | sub-second      | Unpark **after** Vite                           |
| **C. E2E** (Playwright + real VS Code)                    | Real VS Code + real backend | "Does it actually work when shipped?"                                              | seconds–minutes | Build **after** the migration, on the new stack |

Plus the Extension Host **integration** layer (`npm test`), which is currently a no-op and is
covered in the companion document.

### Sequencing

**Revised after review — E2E comes _after_ the migration.** The reference project's own timeline is
the strongest evidence available, and it points the other way from "build the net first":

| Date       | Event                                                                |
| ---------- | -------------------------------------------------------------------- |
| 2026-04-30 | Vite becomes the default build (#2999)                               |
| 2026-05-18 | Production webview rendering fixed after **18 days** broken (#3037)  |
| 2026-05-19 | First releases since the migration: `v0.32.1`, `v0.32.2`             |
| 2026-06-10 | Playwright E2E suite lands (#3136) — **6 weeks after the migration** |

No release was tagged during the broken window, and the fix was never backported to a release
branch — **nothing broken ever shipped**, and they had no E2E at the time. Building this suite
first would also mean building part of it against the outgoing stack: `globalSetup`'s build
invocation is bundler-specific, and the #867 harness is deeply stack-coupled.

The real lesson from those 18 days is narrower and cheaper to act on: **PR #3037 is titled
"restore _production_ rendering"** — dev mode was fine throughout. The bug was invisible to F5.

1. **Phase 0 — a written manual checklist, run against a packaged VSIX.** Not F5. Covers the four
   known failure classes (blank panel, missing CSS, Monaco workers, console errors). ~1 hour to
   write; see the companion document's Phase 0 table.
2. **Migrate** (ESM + Vite + Vitest).
3. **Layer C** — Extension Host integration tests, then Playwright smoke, built on the new stack.
4. **Layer B** — unpark #867 on `vite serve` with typed fixtures.
5. **Grow both suites** feature by feature, as Cosmos DB did (2 specs → 21).

> **Caveat on the precedent.** They got away with it partly because someone eventually built a
> production bundle and noticed. A checklist makes that deterministic rather than lucky, and
> manual verification stops scaling once the webview surface grows much past four panels.

### Copy from Cosmos DB verbatim

- Worker-scoped `vscodeApp`/`vscodeWindow` fixtures + `closeAllEditorTabs` in `afterEach`
- **`consoleHealth` with an empty allowlist** — arguably their best idea, and it applies to Layer B
  as well as C
- Activation handshake before any spec runs
- `runId`-scoped temp/results/reports directories
- Build-mode marker in the staleness check (their #3164 lesson — do not rediscover it)
- Test-only commands gated by an env var **and** a context key
- Self-managed screenshot/trace capture with env-var modes
- Separate Docker compose project and ports for any test backend

### Add from Ref1 (§5)

- **Installed-VSIX lane** — the highest-value single item. It automates the packaged-vs-dev check
  that Phase 0 otherwise does by hand, and it is the mechanism that catches the exact bug class the
  migration is most likely to introduce
- **Capability tags** driving a smoke/nightly split, so one suite serves PR gating, nightly
  regression and release validation
- **A convention scanner script** — machine-enforced E2E rules, which matters disproportionately
  when specs are written by agents
- **Fail-loud CI**: use the CI system's own step outcome rather than a shell-written exit code;
  missing reports must fail aggregation
- **Compose project as the teardown source of truth**, so cleanup never depends on a transient flag
  and never touches unrelated developer containers
- **Seed sentinel** if we seed a database for Layer C
- For Layer B, **put scenario ownership in `dev/`** and keep the test code as a capture adapter

### Fix in #867 before unparking

| Debt                                     | Fix                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Untyped, drifting fixtures               | Derive scenario types from the router's inferred output types; make drift a compile error |
| Built on `dist/views.js` + `writeToDisk` | Rebuild on `vite serve`                                                                   |
| Hand-rolled tRPC envelope                | Use the transport from `@microsoft/vscode-ext-webview`                                    |
| Playwright alpha from an ADO mirror      | Pin to latest stable from the public registry                                             |
| Two runners, neither aware of the other  | One documented entry point; state clearly which command runs what                         |
| CI status undecided                      | **Decide and write it down.** Recommendation: run it in CI — unwired, it rots             |

### Open questions for you

1. **Is Layer C the "new framework" that `npm test` has promised since it became a no-op?** My
   recommendation: `npm test` = Extension Host integration; `npm run e2e` = Playwright. Two names,
   two jobs, both real.
2. **Does DocumentDB need a Dockerised backend for Layer C**, or can a mock/in-memory connection
   cover the first specs? Cosmos DB needed an emulator; our Local Quick Start already implies
   Docker, so the machinery may partly exist.
3. **Screenshots: artifacts or baselines?** #867 argues artifacts-only, and is right _until_ runs
   are standardised on one container image. If Layer C runs on a fixed CI image, baselines become
   defensible there — but keep them out of Layer B on developer machines.

---

## 7. Bottom line

- Cosmos DB's E2E **does not** already include #867's capability. It reaches states by building
  them for real; #867 reaches them by describing them. Both are legitimate, and neither substitutes
  for the other.
- The instinct that "#867 is for quick dev/agent checks" is correct — but it undersells it. Its
  unique, non-replicable value is **deterministic failure and edge states**, which a real-backend
  suite cannot produce cheaply.
- The parking decision was right, and every reason for it is being resolved by the migration.
  Notably, the migration also **fixes the harness's worst flaw** (untyped, drifting fixtures) by
  making typed fixtures possible.
- **E2E belongs after the migration, not before.** That is what the reference project did, and
  nothing broken shipped in the interim. The cheap substitute is a written checklist run against a
  **packaged VSIX** — because the one bug that survived 18 days there was invisible in dev mode.

---

## Appendix A — Source trail

**Cosmos DB** (`main` @ `4b1bb6c`): `test/e2e/README.md`, `test/e2e/specs/*` (21 files),
`fixtures/{vscode,webviewHelpers,webviews,consoleHealth,coverage,queryEditor,documentPanel,migration,controlFile}.ts`,
`helpers/{e2eIsolation,workbenchReady,windowLayout,captureMode}.ts`,
`setup/{globalSetup,globalTeardown,emulator,activation,aggregateCoverage}.ts`,
`src/commands/e2eTestCommands/registerE2eTestCommands.ts`, `playwright.config.ts`,
`docker-compose.e2e.yml`, `.github/workflows/e2e.yml`.
Related PRs: #3136 (introduced), #3164 (production-build guard), #3169 (Monaco workers),
#3172 (React component tests).

**This repo:** [PR #867](https://github.com/microsoft/vscode-documentdb/pull/867) description and
commit list; extracted from #866; label `on-hold`; references
`docs/ai-and-plans/live-preview-playwright-future-work.md` (on `feature/local-quickstart`).

---

## Appendix B — Follow-up research prompt for Ref1

The architecture report for Ref1 answered _what_ and _why_. To act on §5.7 we need _how_: actual
source, operational costs, and honest hindsight. The prompt below is written to be run by an agent
with read access to that repository. Paste it as-is.

```text
# Research request: E2E implementation details, costs, and retrospective

## Context

I maintain a different VS Code database extension. It has four React webviews (Fluent UI,
Monaco, SlickGrid), a tRPC-style webview<->extension-host bridge, and currently **no** E2E or
integration tests (`npm test` is a no-op stub). We are about to migrate the build from webpack
to Vite/ESM, and we will build an E2E layer afterwards.

I have already read the architecture report for this repository's E2E system, so **do not
re-summarise the architecture**. I need implementation detail, real operating costs, and honest
retrospective judgement.

## Output format

Produce **one single Markdown file**. Use fenced code blocks with language tags for all source.
Where a file is long, include the complete file anyway if it is under ~400 lines; otherwise
include the parts I asked for plus enough surrounding context to be usable. Clearly label every
snippet with its repository path. If something does not exist, say so explicitly rather than
inventing it.

## Part 1 — Verbatim source I want to copy or adapt

Include the full current source of:

1. `test/e2e/helpers/e2eIsolation.ts` (run/worker isolation)
2. `scripts/check-e2e-conventions.mjs` (convention scanner) — complete file
3. `playwright.config.ts` — complete file, including the worker resolution helper
4. The default extension fixture under `test/e2e/fixtures/` (the worker-scoped editor fixture) —
   at minimum: the worker-scoped fixture definition,
   the installed-VSIX branch, the native-dialog interception, the deterministic settings block,
   and the per-test cleanup
5. `test/e2e/fixtures/seededWorkspaceFixture.ts` — especially `restartVsCode()`
6. `test/e2e/editors/editorAdapter.ts` — the interface/type definition and one implementation
7. The workbench-readiness helper (whatever waits for activation and the extension surfaces)
8. The `package.json` fragment that declares the test-only inline tree actions, including the
   `when` clauses and the context-key gating
9. The extension-side code that sets the E2E context key from the environment variable

## Part 2 — The installed-VSIX lane (highest priority)

This is the capability I most want to reproduce.

1. How is the VSIX built, located and installed for a test run? Full code path.
2. How do launch arguments differ between source mode and installed mode?
3. Which tests run in this lane, and how are they selected (`@release-core`?)
4. What has this lane actually caught that source-mode E2E did not? Concrete examples if any.
5. Is it run per-PR, nightly, or only at release time? What does it cost in wall-clock time?
6. Any gotchas: extension dependency installation, marketplace lookups, signing, caching.

## Part 3 — Webview testing specifically

My pain is webviews, and the report is thin here.

1. How do specs locate and enter webview iframes? Include the helper source.
2. Are there webview-specific readiness waits beyond generic workbench readiness?
3. Do you assert on console errors originating from webviews? If so, how, and do you allow-list?
4. How are Monaco-based or grid/virtualised webview controls driven reliably?
5. How do you handle webview CSP, `acquireVsCodeApi`, and the `vscode-webview://` origin in tests?
6. Do webview tests run against a production bundle or a dev build? Does it matter?

## Part 4 — Component screenshots project

1. Full architecture: how `dev/componentScreenshotScenarios.tsx`, the scenario metadata, and
   `test/e2e/component-screenshots/` fit together. Include the Playwright config and one
   complete scenario end to end.
2. How are scenarios typed? Is there anything preventing a scenario from drifting away from the
   real component's props/state?
3. How is the host/RPC boundary stubbed, if at all?
4. Are these captures asserted against baselines, or are they artifacts only? Why?
5. Do they run in CI? If yes, how is cross-machine rendering instability handled?
6. In hindsight, has this project earned its keep?

## Part 5 — Capability tags and CI lane wiring

1. The complete tag list and the exact grep/selector expressions each CI lane uses.
2. How tags are validated (the scanner rule).
3. How you decide what earns `@smoke`.
4. The build-once-and-distribute mechanism: what is archived, how it is consumed by matrix jobs.
5. The fail-loud pieces: the step-outcome handling, report-existence checks, and the nightly
   issue open/close lifecycle. Include the workflow YAML fragments.

## Part 6 — Real operating costs (numbers, please)

1. Wall-clock: smoke suite, full suite per shard, full nightly matrix end to end.
2. Flake rate: what percentage of nightly runs fail for non-product reasons? Which areas flake most?
3. How much maintenance does the suite take — roughly how often is E2E infrastructure repaired,
   and what triggers it most (VS Code updates? Cursor updates? Fluent UI upgrades?)
4. How long did the initial 78-test framework take to build, and by how many people?
5. CI cost/runner-minutes if you track it.
6. How many product bugs has the suite actually caught before release? Any notable examples?

## Part 7 — Honest retrospective

Be candid; this is the most valuable section for me.

1. What would you do differently if starting today from zero?
2. Which patterns did **not** pay off, or cost more than they returned?
3. The test-only production seams (inline actions, skipped confirmations, mock auth provider):
   knowing what you know now, would you adopt that approach again? What is the true cost —
   including the reported problem of ordinary clicks hitting E2E-only buttons?
4. Which parts are over-engineering for a smaller extension with ~4 webviews, one backend, and
   no identity/provisioning story?
5. What is the minimum viable version of this system — if you had to rebuild only the 20% that
   delivers 80% of the value, what exactly would you keep?
6. Did the multi-editor (Cursor) adapter earn its cost?
7. Is per-worker database cloning + sharding worth it, or would fewer, better tests be preferable?
8. Anything you consider a mistake that is now hard to reverse?

## Part 8 — Build system (brief)

1. What bundles the extension and the webviews today — webpack, esbuild, Vite, or something else?
2. Have you migrated bundlers recently? If so, what broke, and did E2E catch it?
3. Is the extension ESM or CommonJS? Any packaging lessons worth passing on?

## Part 9 — If you were advising me

Given my situation — four React webviews, no tests today, a webpack→Vite/ESM migration in
progress, work outsourced to coding agents, aiming to build this once and keep it for years —
what would you tell me to build first, second, and third? What would you tell me to skip?
```
