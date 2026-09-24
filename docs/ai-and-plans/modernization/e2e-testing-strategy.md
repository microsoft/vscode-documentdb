# E2E & Visual Testing Strategy

**Research date:** 2026-08-09
**Companion to:** [`build-and-test-stack.md`](./build-and-test-stack.md)
**Subjects:** `microsoft/vscode-cosmosdb` `test/e2e/` (main @ `4b1bb6c`) vs. our parked
[PR #867 — Webview visual harness + Playwright suite](https://github.com/microsoft/vscode-documentdb/pull/867),
plus **Ref1** — an internal, more mature sibling suite, distilled and redacted in Part 5

---

## 0. The question this document answers

> **Status:** the recommendation in Part 6 was revised twice. An early draft argued for building E2E
> _before_ the migration; the reference project's own timeline disproved that. A later revision then
> carved out **one** slice that does belong before it — the installed-VSIX activation check — on
> evidence from Ref1. See Part 6 and the Decision Log in the
> [companion document](./build-and-test-stack.md#decision-log).

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

> Two-way on purpose: this table contrasts the two _mechanisms_ (real editor vs. stubbed browser).
> For a three-way comparison including Ref1, see [§5.15](#515-consolidated-side-by-side).

| Dimension                                     | Cosmos DB E2E                                               | PR #867 harness                                         |
| --------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| **Runtime**                                   | Real VS Code (Electron), real webview host                  | Plain browser (Chromium via Playwright)                 |
| **What it proves**                            | The product works end to end                                | The React UI renders and behaves correctly given inputs |
| **CSP / `acquireVsCodeApi` / `l10n_bundle`**  | Real                                                        | Absent / single stub                                    |
| **Host behaviour**                            | Real (storage, connections, commands)                       | None — by design                                        |
| **Backend**                                   | Real Cosmos DB emulator in Docker                           | Canned fixtures                                         |
| **Startup cost**                              | VS Code launch + Docker (~5s/worker after warm; xvfb on CI) | Page load (sub-second)                                  |
| **Reaching an error/edge state**              | Must be produced for real, or via a test-only command       | `?scenario=...` — instant, arbitrary                    |
| **Theme matrix**                              | Whatever VS Code is running                                 | `?theme=dark \| light`, switchable per URL              |
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

## 4. PR #867 — the goal, the implementation, and what the research changes

### 4.1 The goal, stated independently of the implementation

The PR describes a technical solution. The goal underneath it is more durable than the solution, and
worth separating, because the research points at a different vehicle for the same goal.

> **Reach any UI state deterministically, in well under a second, with no extension host, no
> backend, no Docker and no human — and let three different consumers act on it.**

| Consumer     | What they do with it                                                                      | What it replaces                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Reviewer** | Sees every state of a panel without building and running the extension                    | "trust me, it looks right" — or a bug-bash                                                                                      |
| **Agent**    | Drives the state with browser tools; reads `window.__harnessCalls` to assert side effects | A state that "otherwise needs a human, Docker, and several minutes" — the PR's own words, and it calls this "most of the value" |
| **CI**       | Asserts the state                                                                         | Nothing. `npm test` is a no-op stub today                                                                                       |

Three properties make it work, and all three belong to the goal rather than the implementation:

1. **State is described, not produced.** `?scenario=...` — no orchestration, no seeding, no waiting.
2. **Everything below one stub is shipped code.** Real React tree, real Fluent styling, real DOM,
   real localization lookup path. Exactly one global is faked.
3. **Escaping actions are recorded, not performed.** `window.__harnessCalls` is how _"the Windows
   install button opens the Docker Desktop page"_ gets asserted without leaving the page.

**Property 3 is the sharpest idea in the PR and the most transferable.** It asserts at the boundary
the UI is trying to cross. Neither reference project does this: Ref1's component-screenshot harness
makes `postMessage` a silent no-op, so it can assert what _rendered_ but never what the UI _tried to
do_. Cosmos DB asserts the consequence in a real editor, expensively.

And the benefit neither real-backend suite can buy at any price: **deterministic failure and edge
states.** "Docker daemon not running", "image pull failed", "port already bound", "network timeout"
are one-line fixtures here and genuine orchestration problems against a live backend.

### 4.2 What the research solves outright

Every documented problem and open decision in the PR, against what this research turned up.

| #867 problem or open decision                                                                            | Answer                                                                                                                                                                                                                                           | Source                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| Stale `dist/views.js` — "the number one time waster", patched with `devServer.devMiddleware.writeToDisk` | Vite's dev server serves modules over HTTP natively. **The failure mode ceases to exist** — delete the patch rather than porting it                                                                                                              | The migration            |
| "the suite does **NOT** build for you"                                                                   | `globalSetup` auto-runs the production build when output is older than source — **and encodes build _mode_, not just mtime**, because a dev watch build looked newer by timestamp and silently broke rendering                                   | Cosmos DB #3164          |
| Untyped fixtures drifting into fiction                                                                   | Type scenarios against the router's inferred output types, so drift is a **compile error**. Add `as const satisfies` on the scenario list, `satisfies Record<ScenarioId, …>` on expectations, and a load-time registry-drift assertion           | The package + Ref1       |
| Scenarios are untyped JS object literals **inside the HTML**                                             | Move ownership to `dev/`, beside the components they describe. Test code becomes "only a capture adapter"                                                                                                                                        | Ref1 §5.9                |
| Hand-rolled tRPC envelope `{id, op:{type, path, input}}`                                                 | Use the real transport, and back scenarios with a **fake transport** resolving procedure calls from a fixture map — which also reaches components that fetch on mount, something prop injection cannot                                           | The package + §7.2       |
| `goto(waitUntil:'load')` hangs on an unsettled call; the harness sets `window.__harnessReady` at a phase | **Promote it into the product** as `data-webview-id` + `data-ready`. One contract then serves the harness _and_ the packaged-VSIX tripwire. The PR already invented the mechanism — it is in the wrong place                                     | §5.7, and #867's own fix |
| No console-error policy anywhere                                                                         | Add `consoleHealth` **here first**. The harness is the cheapest place in the entire plan to run it: real bundle, real browser, no Electron, sub-second — and module-resolution or circular-import breakage is precisely what the migration risks | Cosmos DB                |
| "Two runners, neither sees the other"                                                                    | One runner, if the harness moves to Vitest browser mode (§4.3). Otherwise: one documented entry point, and write down what each command does and does not cover                                                                                  | §4.3                     |
| `@playwright/test` is a caret-ranged alpha from an ADO mirror with sha1 integrity hashes                 | Pin to latest stable from the public registry. Ref1 pins its editor version and treats bumps as explicit work; its unpinned second editor is its largest recurring tax. Same discipline, applied to the runner                                   | Ref1 §5.6                |
| "Screenshots are artifacts, not baselines, and deliberately so"                                          | **Settled — do not revisit.** Both reference projects independently reached the same conclusion for the same reason (OS-rendered text). Baselines only become defensible once runs are standardised on one container image                       | Both                     |
| "CI or explicitly manual?"                                                                               | **The question conflates two artifacts.** See §4.4                                                                                                                                                                                               | §4.4                     |
| HMR lies after a hook change; `box-sizing: content-box`                                                  | Unaffected by any of this. Keep the notes                                                                                                                                                                                                        | —                        |

### 4.3 The vehicle question — three ways to build the same goal

The PR builds `serve.js` + a static HTML page + a separate Playwright project. **That was the right
call on webpack.** On Vite it is no longer the only option, and probably not the best one.

| Option                                      | Shape                                                                                                                                | Value    | Complexity | Carry   | Verdict                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.** Port it as-is                        | `vite serve` replaces `serve.js`; keep the HTML page and the separate Playwright project                                             | Medium   | S          | Medium  | Cheapest move, but keeps two runners and a bespoke page forever                                                                                                                              |
| **B.** Vite entry + **Vitest browser mode** | Scenarios become a real Vite entry; assertions run in Vitest's browser mode against real Chromium, sharing the product's Vite config | **High** | M          | **Low** | **Recommended.** One config, one runner, no `serve.js`, no hand-written HTML, no staleness problem. Playwright then exists only for the packaged-VSIX tripwire                               |
| **C.** Adopt Storybook                      | Replace the harness with Storybook plus a test runner                                                                                | Low      | L          | Ongoing | Ref1's report is blunt: they "effectively built a minimal, bespoke Storybook", and bespoke is cheaper at ~12 scenarios though not at ~50. We are at ~12. A second toolchain to carry forever |

**Option B dissolves three of the PR's four open decisions at once** — the runner question, the
staleness question, and "is this the new `npm test`?" (no: `npm test` becomes the host integration
layer; this becomes part of the unit/component run). Cosmos DB already added React component tests
with Testing Library under Vitest (#3172); option B puts our harness in that same runner rather than
beside it.

Keep a `?scenario=` route served by `vite dev` regardless of the option chosen. That is the human and
agent entry point, and it is strictly better than a hand-written HTML page — Ref1's report says so
about its own equivalent.

### 4.4 The CI decision, split

The PR asks "CI or explicitly manual?" and correctly notes that unwired, a visual suite rots into
fake coverage. Both reference projects answered by **not** wiring their component-screenshot work
into CI — and Ref1's report then concedes that nothing stops it silently breaking.

The question conflates two artifacts with different economics:

| Artifact                                                                      | Deterministic?                                 | Wire into CI?                                                     |
| ----------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| The **assertions** — DOM state, `window.__harnessCalls`, console-error checks | **Yes** — no Electron, no Docker, no network   | **Yes.** They are as cheap as unit tests, and they rot without it |
| The **screenshots**                                                           | **No** — OS text rendering differs per machine | **No baselines.** Artifacts only, published for PR review         |

Neither reference project drew this line explicitly. Both let the screenshot half decide for the
assertion half, and lost the assertions. That is the specific mistake to avoid.

### 4.5 The one thing #867 does that neither reference project does

> `git revert --no-commit bc08cfd1` — undo the webview fixes — then run the suite and expect
> **exactly** those assertions to fail, everything else green.

That is a **mutation test on the test suite itself**. The PR calls it "the only falsifiable claim
about this suite" and notes it currently exists only as a sentence in a commit message.

Neither reference project has anything equivalent. Ref1 has a commit titled _"stabilize flaky
Playwright helpers and **false-green coverage**"_ — an admission that some of its tests were passing
without testing anything, discovered the hard way. A mutation check is the cheapest possible defence
against exactly that, and it is the one practice in this entire document we would be **exporting**
rather than importing.

**Make it a script rather than a sentence**, and run it whenever the suite changes materially.
Value High · Complexity S · Carry None.

### 4.6 What to keep untouched

- **Artifacts, not baselines.** Independently confirmed twice; the reasoning is sound.
- **`window.__harnessCalls`.** Better than either reference project's host stub (§4.1).
- **The honest non-scope section.** It is why the harness was never over-claimed, and it is what
  lets this document place it precisely as Layer 3 in §7.2.
- **Deleting the `success-relocated-port` scenario** because the product no longer behaves that way.
  A fixture describing behaviour the product does not have is exactly how a harness drifts into
  fiction — the same failure the typed-fixture fix prevents structurally.

---

## 5. Ref1 — the older, larger sibling

> **Ref1** is another internal VS Code database extension with a mature Playwright E2E system.
> A detailed, source-quoting architecture report on it was produced for this analysis and is
> distilled below. The project name, repository URLs, internal PR numbers, contributor names and
> the backing database engine are deliberately redacted; where a quotation would reveal them it is
> replaced with `[Ref1]`, `<ext>` (identifier prefix) or `<EXT>` (environment-variable prefix).
>
> **Evidence grading, carried over from that report — do not discard it.** Its figures come in
> three grades and they are not interchangeable:
>
> - **Measured from source** — static counts (`wc -l`, `grep -c`, `git log`). Reliable.
> - **Declared in repo** — timeouts, shard counts, README claims. These are _budgets and
>   assertions_, not observations, and may be stale.
> - **NOT AVAILABLE** — anything requiring a test run, a CI dashboard, or operator memory.
>
> No suite was executed and no CI history was queried while producing the report. The
> `NOT AVAILABLE` markers below are kept on purpose: substituting plausible numbers for them would
> make this section actively harmful for planning.

### 5.1 Cosmos DB is a documented subset of Ref1, not an independent design

This is settled by Cosmos DB's own public E2E README:

> "The scaffold borrows heavily from the sibling `[Ref1]` project's `test/e2e/` setup. We kept the
> patterns that pay off immediately and **skipped the ones we don't yet need (multi-editor adapter,
> reusable auth profile, @tag-based grep filtering, JUnit reporter)**."

So the question is not "which approach is better". It is **"how much of Ref1 do you need yet?"**
Cosmos DB answered that question once already, in writing, and later partially reversed one of the
four omissions (JUnit output was added for one of their workflows).

**Maturity gap:**

|                 | Ref1                                                                                                              | Cosmos DB     |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | ------------- |
| E2E started     | Feb 2026                                                                                                          | Jun 2026      |
| Initial landing | Infrastructure + **154 tests** + CI workflows, ~1 month, effectively **one** engineer                             | 2 specs       |
| Current size    | 113 spec files, **~294 runnable** (~58 smoke), **38,877 lines**                                                   | 21 spec files |
| Editors         | VS Code **and** a second editor (a VS Code fork)                                                                  | VS Code       |
| Parallelism     | Per-worker cloned DBs + 4 shards × 2 editors nightly — yet `workers: 1` and `fullyParallel: false` **by default** | 1 worker      |
| Backend         | 6 containerised services + SSL/SSH artifacts                                                                      | 1 emulator    |
| Carrying cost   | **~130 lines of E2E code per runnable test**                                                                      | not measured  |

> **Correction to an earlier draft of this document.** It said Ref1's initial framework was
> 78 tests. The landing commit says **154**, and the number 78 does not appear anywhere in that
> repository. Also corrected: `resolveE2eWorkers()` lives in a helper module, not in
> `playwright.config.ts`.

Ref1 is roughly four months and an order of magnitude ahead. That is context, not criticism of
either: Cosmos DB deliberately took an MVP slice.

> The rest of Part 5 compares the two thematically. For a single dimension-by-dimension matrix
> including where **we** should land, jump to [§5.15](#515-consolidated-side-by-side).

### 5.2 The numbers that should set our budget

Only three of Ref1's figures are load-bearing for our planning, and one of them is a ratio rather
than a total.

| Figure                                           | Value                                                                                        | Grade                             |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------- |
| Lines of E2E code per runnable test              | **~130** (38,877 ÷ ~294, including helpers and fixtures)                                     | Measured from source              |
| Build cost of the initial framework + ~150 tests | **~1 month, effectively one engineer**                                                       | Measured from source (git)        |
| Carrying cost                                    | **81 commits / 8 authors over 6 active months — still rising** (11 → 16 → 24 → 18 per month) | Measured from source (git)        |
| Smoke suite wall-clock                           | ~8 min                                                                                       | Declared in repo (README claim)   |
| Full suite wall-clock, local                     | ~20 min                                                                                      | Declared in repo (README claim)   |
| Slowest single test                              | ~96 s                                                                                        | Declared in repo (config comment) |
| Flake **rate**                                   | **NOT AVAILABLE**                                                                            | Needs CI history                  |
| CI runner-minutes                                | **NOT AVAILABLE** — nothing in-repo tracks cost                                              | Needs billing API                 |
| Product bugs caught before release               | **NOT AVAILABLE** — no in-repo record                                                        | Needs issue history               |

**The planning conclusion is the ratio, not the totals.** Build cost is a month; carrying cost is
open-ended and still growing nine months in. A 40-test suite at the same density is ~5,000 lines —
a real but bounded liability. A 300-test suite is ~39,000 lines and becomes a workstream.

**Flake location is available even though flake rate is not**, and it is more useful. Ref1's CI
contains a seven-signature regex used to recognise non-product failures:

```
SIGTRAP | worker-N process did not exit | electron.launch: Process failed to launch
| electron.launch: WebSocket error | socket hang up / ECONNRESET
| Target page, context or browser has been closed | Tearing down "<app>" exceeded
```

**Every signature is editor launch or teardown — none is a selector, an assertion, or the
database.** That regex _is_ the flake taxonomy, and it says the cost driver is that each test
launches an entire Electron application. Two further tells: nightly needs a **two-phase retry**
(in-process `--retries=2`, then a _fresh process with a wiped user-data dir_ and `--retries=1`,
for up to six attempts per test), and the tolerance classifier is scoped to the **second editor
only** — VS Code did not need it.

### 5.3 What Ref1 has that Cosmos DB does not

| Capability                                                                                                                                                                   | Why it matters to us                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Installed-VSIX lane** (`<EXT>_E2E_INSTALLED_VSIX`) — installs a packaged VSIX into a test-scoped extensions dir and tests **that** instead of `--extensionDevelopmentPath` | **The single most relevant item in the whole report.** It automates exactly the dev-vs-packaged gap that let Cosmos DB's blank-webview bug survive 18 days, and that our Phase 0 checklist currently covers by hand. See §5.4 |
| **Component-screenshots project** — isolated React scenarios captured without the full backend; scenario ownership in `dev/`, test code is only a capture adapter            | Independent convergence on PR #867's idea, with a cleaner ownership split. See §5.9                                                                                                                                           |
| **Convention scanner** (`check-e2e-conventions.mjs`) — ~120 lines of plain Node, no dependencies                                                                             | Machine-enforces the E2E rules. High value when tests are written by agents. See §5.8                                                                                                                                         |
| **Capability tags** (`@smoke`, `@requires-db`, `@requires-ssl`, `@release-core`, …) driving CI lane selection                                                                | Lets one suite serve PR smoke, nightly full, and release validation                                                                                                                                                           |
| **Seeded workspace fixture** with a real `restartVsCode()`                                                                                                                   | Tests settings-scope precedence and restart persistence — directly relevant to our connection storage and settings scopes                                                                                                     |
| **Editor adapter** (VS Code + a second editor)                                                                                                                               | The abstraction is sound; the **second editor is their clearest negative verdict**. See §5.6                                                                                                                                  |
| **Seed sentinel** — poll a `_e2e_seed_complete` marker rather than DB health                                                                                                 | Avoids racing the tail of seeding (grants, policies, statistics)                                                                                                                                                              |
| **Compose project as teardown source of truth**                                                                                                                              | Cleans only this run's resources; never sweeps a developer's containers                                                                                                                                                       |
| **Fail-loud CI** — use the CI system's own step outcome, not a shell-written exit code                                                                                       | They shipped a bug where a timed-out E2E step reported success. See §5.8                                                                                                                                                      |
| **Nightly issue lifecycle** — open on failure, auto-close on recovery, and failing to notify is itself a failure                                                             | Prevents silent rot                                                                                                                                                                                                           |
| **Rich helper diagnostics** — rejected candidates, CSS state, overflow contents, open tabs + frame URLs                                                                      | "Locator not found" is useless in virtualized editor UI                                                                                                                                                                       |
| **`dumpWorkbenchDiagnostics`**                                                                                                                                               | Turns an unreproducible CI-only launch failure into a one-look diagnosis                                                                                                                                                      |

### 5.4 The installed-VSIX lane — the single highest-value artifact

Everything funnels through one environment variable (`<EXT>_E2E_INSTALLED_VSIX`) and one ~110-line
helper. The helper is a **pure function over launch arguments** — no Playwright, no Electron, no
I/O beyond an injectable `existsSync` — which is why it is itself unit-testable and unit-tested.

Two transforms, applied to the shared base launch args:

| Mode                | `--disable-extensions`                 | `--extensionDevelopmentPath=`        |
| ------------------- | -------------------------------------- | ------------------------------------ |
| Source mode         | → `--extensions-dir=<worker temp dir>` | **kept**                             |
| Installed-VSIX mode | → `--extensions-dir=<worker temp dir>` | **removed**, and asserted to be gone |

**Three guards, and the third is the reason to copy this at all:**

1. Env var set but file missing → throw.
2. `--extensions-dir` missing after rewriting → throw.
3. Env var set but an `--extensionDevelopmentPath=` argument survived → throw, with the message
   _"Installed-VSIX e2e runs must not fall back to source."_

Guard 3 makes the catastrophic failure mode — a lane that _silently tests source anyway_ and
returns a green release signal proving nothing — **structurally unrepresentable**. The same
instinct appears twice more in their CI: a step that refuses to validate a checkout predating the
bridge, and a step that fails when a red run could not file its failure issue. Those are not bugs
caught; they are **bug classes made impossible**, which is the more durable value.

**And here is their mistake, which is the actionable part for us.** The lane's only trigger is
`workflow_dispatch`. No `schedule`, no `pull_request`, no `push`. They performed an extension-host
**bundler migration** and it was therefore _never continuously validated against a packaged
artifact_; roughly six weeks later a fix titled "…in packaged extension" landed. Causation is not
provable from the repository and the report says so explicitly — but the **structural gap is real
regardless**, and it is precisely the gap we are about to open.

Gotchas worth knowing before we build this:

- **`extensionDependencies` are not installed.** The extensions dir is wiped and exactly one VSIX
  is installed with `--force`. If we declare dependencies, this lane will not work unmodified.
- **Marketplace lookups are not disabled.** `--disable-updates` is passed at _launch_, not at
  _install_. On a network-restricted runner this is a live risk.
- **Signature verification is unhandled.** No `--skip-verify-signature`, no signing step. Their
  release lane also _rewrites_ the downloaded VSIX to strip telemetry keys, which would invalidate
  any signature — a strong hint that verification is not enforced on this path today, and a
  fragile assumption to inherit.
- **On Windows the CLI resolves to a `.cmd` wrapper**, which Node's `spawnSync` refuses to execute
  without `shell: true` (`EINVAL` since the CVE-2024-27980 fix) — and once a shell is involved,
  every path-bearing argument must be quoted.
- **`--profile` is mandatory when launching a named profile**, or the VSIX registers only against
  the default profile and is silently not enabled — a no-op that looks like an activation bug.
- **Do not patch source files from a workflow.** Their release lane string-replaces a TypeScript
  file to inject `--disable-telemetry`; reformat the function and the anchor stops matching,
  silently. Use a runtime environment check.

### 5.5 What Cosmos DB has that Ref1 does not

Two of these were **verified absent** in Ref1 rather than merely unmentioned, and the first is the
most important single finding in the whole report:

- **`consoleHealth`.** Ref1 has **no console-error assertions anywhere**. A search of its entire E2E
  tree for `page.on("console")`, `page.on("pageerror")`, `page.on("crash")` and
  `page.on("requestfailed")` returned **zero matches**. Cosmos DB's `consoleHealth` fixture, with
  its deliberately empty allowlist, is something the mature original does not have.
- **A readiness contract in the product.** Ref1 has none, and pays ~115 lines of frame-selection
  heuristics for it (§5.7).

Treat the remaining two as "not evidenced" rather than "missing":

- **E2E coverage collection** and aggregation.
- **Build-staleness detection with a production-build marker**, and a single env knob for
  screenshot/trace capture modes.

### 5.6 Their own retrospective — the warnings that should survive any summary

The report's author was asked for candour and gave it. These are the findings flagged as "would say
out loud".

**1. No console-error assertions exist. At all.**
For a team migrating a bundler this is the highest value-per-line addition available, because the
characteristic failure of that migration — a module that fails to resolve, or a circular import
evaluating to `undefined` — produces a console error and a **partially** rendered panel that DOM
assertions happily pass. Retrofitting later is painful: you inherit a backlog of pre-existing noise
to triage. On day one the allowlist is empty and stays honest.

**2. Production test seams do not stay in their lane — and it is provable, not anecdotal.**
`<ext>.e2eTestMode` gates **23 inline tree buttons** and is consulted in **8 production files**.
The consequences compound:

- An unrelated drag test clamps its origin to `x: Math.min(80, box.width / 2)` — the left 80 px of
  the row — because the right-hand side now carries up to eight test-only buttons. The seam
  corrupted the coordinate space every other test operates in, and the compensation is invisible at
  the call site.
- One command is declared **twice** in `package.json` (once for users, once for E2E), so the menu
  contract can drift.
- Unit tests now pin E2E-only `when` clauses — test scaffolding with its own regression tests.
- The flag stopped being a test flag: it ended up gating a **feature**
  (`(<ext>.isVSCode || <ext>.e2eTestMode) && config.<ext>.enableMigrations`).
- One surface is gated behind the flag **and** deliberately excluded from the bundle, so in E2E mode
  the menu item exists and the webview bundle does not.
- It ships in the released VSIX. A user setting `<EXT>_E2E_TEST=1` gets 23 extra buttons, no delete
  confirmation, a simulator mode, and altered auth. Not a security boundary — but
  "delete without confirmation" is a real behaviour change reachable by an environment variable.

The origin was legitimate: Electron native-menu `item.click()` does not carry tree-node context to
editor commands, and after trying `Menu.prototype.popup` interception, native `MenuItem.click()`,
keyboard navigation and IPC bridging, they concluded native context menus are **not a reliable
command path at all**. The right response is still not 23 permanent menu entries — it is **one**
test-only command taking a node id.

Their own best-designed seam shows the bar: an auth-injection module that is inert unless **both**
test mode is on **and** an injected-token source is present, isolated in a dedicated directory, and
documented with an explicit justification for why no alternative exists.

> **Generalisable rule, and the one to write into our own instructions:** a test seam that changes
> _what the UI looks like_ is far more expensive than one that changes _what a function returns_.
> Prefer seams at the data/service boundary. Never at the layout boundary.

**3. Parallelism is off by default.** `workers: 1`, `fullyParallel: false` — after building full
worker-scoped isolation _and_ per-worker database cloning. The repository contradicts its own
investment. The isolation still earns its keep, because it is what makes sharding across CI _jobs_
safe and concurrent local runs non-destructive. The in-job parallelism does not: the real constraint
is that every test launches an entire Electron application, and parallelism multiplies memory
pressure against exactly that.

**4. The second editor did not earn its cost.** 546 lines versus 97 for the VS Code adapter; four
adapter hooks that exist for nothing else; 50% of nightly CI; a 75%-longer PR smoke timeout; a
documented _"when a bump breaks the smoke job"_ runbook — because it deliberately tracks **unpinned
latest stable**; and a six-condition classifier that **downgrades its failures to non-failures**.
A lane whose failures you have taught CI to ignore is not a signal; it is noise plus maintenance.
The `EditorAdapter` abstraction itself is fine, and refactoring to it from a concrete implementation
is a day's work — far cheaper than carrying it speculatively.

**Two more from the same chapter:**

- **Pin the editor version and treat bumps as explicit work.** VS Code _is_ pinned in Ref1; the
  second editor deliberately is not, and that single choice is the largest recurring tax.
- **Maintenance triggers, ranked by evidence strength:** editor releases first (the unpinned second
  editor, then VS Code UI changes — sticky tree headers and an auto-opening chat sidebar each name a
  specific version that broke things), then CI runner-image retirement, then Node/OS security
  changes. **Fluent UI upgrades are not evidenced as a maintenance driver.** There is selector
  _guidance_ (`getByRole` over `getByLabel`; `toContainText` rather than `toHaveValue` for
  comboboxes) implying past pain, but nothing ties it to a version bump.

### 5.7 The webview-testing playbook

This is the chapter that maps most directly onto our four React webviews.

**The missing readiness contract is the root of most of the cost.** Ref1 uses no `frameLocator` at
all; it filters `page.frames()` for any frame with a parent and then runs a **115-line, four-signal
cascade** — tab selection, a caller-supplied `isReady` predicate, tri-state visibility (`true` /
`false` / `undefined` when the frame detaches mid-check), and finally title text — with four
fallback accumulators that degrade gracefully as a 30-second budget expires. Seven dedicated unit
tests exist purely for its tie-breaking, with names that read as a bug log (_"waits for the selected
visible frame instead of returning a stale hidden ready frame"_). There are ~17 call sites, each
with its own hand-written readiness disjunction. The engineering quality is high; its **existence**
is the problem.

Two of their readiness waits are worse than that: they swallow their own timeouts
(`.waitFor({ state: 'hidden' }).catch(() => {})`), so they are not gates at all.

**What we should do instead, and it is cheap because we own the source** — publish a marker from
each webview root, set only after the React root has mounted **and** the first bridge round-trip has
resolved:

```tsx
<div data-webview-id="collectionView" data-ready={isReady ? 'true' : 'false'}>
```

That collapses 115 lines of heuristics into one locator. We have four webviews and a tRPC-style
bridge, so we know precisely when "ready" is true. Ref1 could not retrofit this across ~25 entry
points; we can build it for four from the start. Notably, a `data-testid` convention **does** exist
in their codebase — it was just applied inconsistently, and that inconsistency is the direct cause
of the heuristic sprawl.

**Copy verbatim:**

| Technique                                                                                               | Note                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Diagnostics in the failure message — open tab labels + frame URLs                                       | Turns an opaque 30 s timeout into a diagnosis                                                                                        |
| Unit-test frame selection against **stubbed** `Frame` objects                                           | Verifies the gnarly logic without launching an editor                                                                                |
| `keyboard.insertText` instead of per-character typing for Monaco                                        | Make it the default; per-character typing triggers IntelliSense                                                                      |
| `toPass` around the whole **scroll-then-assert** block for virtualised grids                            | Retry the action, not just the assertion                                                                                             |
| `dispatchEvent(new Event('scroll', { bubbles: true }))` after setting `scrollTop`                       | SlickGrid listens for the event; a programmatic assignment does not reliably produce one in a headless renderer                      |
| Assert "at least N rows" or "this value is reachable after scrolling" — never exact counts              | Row counts are a function of viewport height, which is a function of the runner                                                      |
| Scope row selectors to the grid canvas                                                                  | SlickGrid gives its header `role="row"`, so `getByRole('row')` silently returns one extra — an off-by-one that looks like a data bug |
| Assert on the **absence of a bad state** (e.g. poll that the count of "Disconnected" status items is 0) | Frequently more robust than waiting for a good state to appear                                                                       |

**The single most valuable comment in their entire E2E codebase** documents an IntelliSense failure:
when typing a multi-line query, the suggest widget intercepts the literal `Enter` and _accepts a
suggestion instead of inserting a newline_, silently welding two lines into a token the engine then
rejects — a downstream error that looks exactly like a product bug. The fix: split on newline, pause
~100–200 ms for the widget to appear, press `Escape`, then send an explicit `Enter`. If we type into
Monaco with any completion provider attached — and we have one — we will hit this.

**On CSP and `acquireVsCodeApi`:** in a real-editor E2E run none of it needs handling. The CSP is the
production CSP, `acquireVsCodeApi` is the real implementation, and Playwright uses the CDP frame API
rather than DOM traversal across origins. Stubbing is only required **outside** E2E, in a component
harness — which is exactly PR #867's territory (§5.9).

### 5.8 Tags, lanes, and the fail-loud CI machinery

**Tags.** Ref1 has 13, and they mix **two taxonomies in one namespace**: _selection_ tags
(`@smoke`, `@release-core` — editorial: "is this important enough for lane X?") and _capability_
tags (everything else — declarative: "what does this test need in order to run?"). Capability tags
compose cleanly; selection tags do not. Mixing them is why the lane grep expressions get long — each
lane must express both what it wants **and** what it cannot provide.

The convention scanner's **highest-value rule is the tag allowlist**, because a mistyped tag produces
**no error anywhere**: the test just quietly stops running, forever. Its second rule encodes a lane
invariant in the linter ("`@release-core` means runs anywhere with no infrastructure, so it cannot
also be `@requires-ssl`") instead of discovering it at 2 a.m. on a release runner. Stated
limitations, worth knowing before copying: it is line-based regex, so a title on the following line
is invisible, and the `test.describe(..., { tag: [...] })` metadata form is **not checked at all**.

It also does something quietly clever: it does not ban `waitForTimeout`, it **counts and ranks** it,
printing the top five files. That converts a style argument into a number that trends. For us the
right call is stronger — **ban it outright now**, while the count is zero.

**How they choose `@smoke`** is a quota: "2–3 per feature area", author's discretion, ~20% of the
suite. It optimises for breadth over risk. The report's better rule, and the one we should adopt:
**tag `@smoke` only if failure means "do not ship"**. That naturally selects activation, the bridge
round-trip, and one end-to-end path per webview — a smaller and far more informative set.

**Build once, distribute — with three verification layers.** Most teams do the first; the third is
the one that saves you.

1. **Pre-archive assertions** (`test -f` / `test -d`) on every expected path, plus a _semantic_
   completeness check — a marker file proving a component finished installing, not merely that its
   directory exists. A missing directory then fails the build job, not eight downstream test jobs.
2. Archive the paths.
3. **Post-archive verification** — re-read the archive (`tar tzf … | grep -E`) to confirm the
   critical paths are genuinely inside it. This catches the `shopt -s nullglob` failure mode where an
   unmatched glob silently expands to nothing and you ship an archive missing a component.
4. `if-no-files-found: error` on upload — the artifact action defaults to `warn`.

Consumers re-run the same check after extraction. **Verify on both ends.**

**Fail-loud, in order of how much we should want it:**

- **`continue-on-error: true` on the test step plus an explicit final gate on `steps.<id>.outcome`.**
  This captures artifacts on failure _and_ catches `timeout-minutes` enforcement, which a bare
  non-zero-exit check misses.
- **Report-existence checks.** A shard that produced no blob report is a **failure**, not an absence
  of evidence. The aggregate carries an explicit expected-shard list, so a job cannot pass by simply
  not producing an artifact.
- **Distinguish "0 failures" from "no summary at all"** — render `n/a — no summary observed` rather
  than a misleading `0/0/0`.
- **The two guards that make alerting trustworthy**, and the best idea in their CI: fail the build
  when a red run **could not file** its failure issue, and when a recovered run **could not close**
  one. Note the comparison is `!= 'false'`, not `== 'true'` — an unset output, because the step
  crashed, counts as failure. Most teams discover their alerting was broken only after a month of
  silent red.
- **Only short, single-line scalars go to `$GITHUB_OUTPUT`;** multi-line failure detail is read from
  the workspace with `readFileSync`. A test name containing the heredoc delimiter could otherwise
  corrupt the file-command parser and silently skip the notification step. That is a genuine
  security-and-correctness insight, and worth copying together with its reasoning.
- **Blame windows anchored to the last _successful scheduled_ run**, not a fixed 24 hours.
- **Serialise the issue-mutating job** (concurrency group per workflow + ref) so two overlapping runs
  cannot each observe an empty match set and open duplicate issues.
- Derive Docker image lists from `docker compose config --images` so the cache key cannot drift from
  the compose file, and retry pulls with linear backoff — registry pulls are the flakiest step in any
  containerised CI.

### 5.9 Ref1 validates PR #867 — and offers a better home for it

Ref1 runs **three** distinct Playwright uses, not one:

| Project                   | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| Main E2E                  | Behavioural regression against real editor + real database             |
| Docs screenshots          | Deterministic documentation PNGs; own config; excluded from regression |
| **Component screenshots** | **Isolated React scenarios captured without the full backend**         |

That third project is PR #867's concept, arrived at independently — strong evidence the idea is
sound rather than a workaround. But the detailed report tempers the endorsement considerably:

- It is **12 scenarios in one feature area**, one 74-line spec, roughly **340 lines total**.
- It **does not run in CI** — zero references in any workflow; the main Playwright config actively
  excludes the directory.
- It captures with `locator.screenshot({ path })`, **not** `expect(...).toHaveScreenshot()`. There
  are **no baselines, no diffing, no `maxDiffPixels`**. The only per-scenario assertion is a single
  exact-text visibility check.
- Its stated purpose is **PR-review embeds** — letting a reviewer see the UI without building and
  running the extension.

Their reasoning for artifacts-over-baselines is the same as #867's and is correct: cross-platform
pixel diffing of Fluent UI is a tar pit of font hinting, subpixel AA and scrollbar rendering, and
every legitimate UI change would produce a diff failure demanding a baseline update.

**Three idioms worth copying outright, independent of everything else:**

1. **Scenario ownership lives in `dev/`, not in the test folder.** Test code is "only a capture
   adapter". This directly addresses #867's worst flaw — fixtures drifting into fiction — because the
   scenarios sit next to the components they describe rather than inside an HTML file.
2. **`as const satisfies readonly Metadata[]`** on the scenario list. It yields literal-type
   inference for the ids (a real union, not `string`), structural validation against the interface,
   and a compile error if the declared default id is not one of them.
3. **`satisfies Record<ScenarioId, string>`** on the spec's expectation map, plus a **load-time
   registry-drift assertion** that throws if the metadata list and the registered scenarios diverge.
   Adding a scenario without adding its expectation becomes a compile error.

**What their design does _not_ protect against, and neither would ours:** props are typed, but
rendering is not verified; a scenario can describe a state the product can no longer produce and
will keep rendering happily forever. Typed inputs, unverified output — the right trade for a
screenshot _generator_, the wrong one for a visual regression suite.

**One place where we should do better than them.** Their host stub is an esbuild banner that makes
`acquireVsCodeApi().postMessage` a no-op, so only components that receive their state as props can
be rendered — a component that fetches its own data on mount would hang forever. With our tRPC-style
bridge the equivalent is a **fake transport resolving procedure calls from a per-scenario fixture
map**. That is more work and considerably more valuable: it reaches loading, error and empty states
that prop injection cannot.

Their own warning, matching Part 3 of this document: component screenshots "should not become a
substitute for full E2E tests".

### 5.10 Where they converged independently — the strongest signal

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

One small implementation detail from Ref1's isolation module that is invisible until it bites:
worker directories are named `u` and `w` — **one character on purpose**. macOS Unix domain sockets
have a 103-character path limit, VS Code's IPC socket path is derived from the user-data dir, and a
long temp path breaks launch on macOS with an opaque error. If we copy nothing else from that file,
copy that constraint.

### 5.11 Costs and cautions, from Ref1's own risk list

Ref1 is candid about what its approach costs — worth reading before copying it wholesale:

- **Test-mode UI divergence.** Test-only inline buttons change the tree UI while E2E mode is on, and
  ordinary row clicks or drag coordinates can hit them. Quantified in §5.6: the seam has a blast
  radius.
- **Production code carries E2E-gated behaviour.** Test-only commands, skipped confirmations,
  injected tokens, a mock auth provider. Defensible and double-gated where done well, but a real
  trade-off some teams would reject outright.
- **Retry masking.** In-process retries plus a second-pass retry can hide genuine regressions when
  assertions are weak. Their effective budget is up to **six attempts per test**.
- **Scale cost.** ~294 tests × 2 editors × 4 shards needs long timeouts, image caching and
  build-once distribution.
- **Native menus remain unsolved**, which is what drove the 23-button seam in the first place.
- **False-green is a real historical failure mode here.** One of their own commits is titled
  _"stabilize flaky Playwright helpers and false-green coverage"_ — an admission that some tests were
  passing without testing anything. Weigh that against any "bugs caught" claim.
- **Documentation drift.** Their README still says "only setup to run locally" despite extensive CI.

### 5.12 Because our work is outsourced to coding agents

This changes the calculus, and the report is explicit about how: **more mechanical enforcement,
fewer conventions-by-documentation.** Agents follow patterns they can see in existing code and
violate rules that live only in prose.

1. **Ship the convention scanner on day one, in `--strict` mode, wired into PR CI.** A ~120-line
   dependency-free Node script is the cheapest way to make rules executable. Ref1 runs theirs
   warning-only by default, which is the weaker choice.
2. **Make the readiness contract the _only_ way to find a webview** — add a scanner rule banning
   `page.frames()` and `frameLocator` outside one helper. Otherwise we get 17 bespoke readiness
   predicates, exactly as they did.
3. **Write "how to add a test" as a numbered procedure**, one screen long. Agents follow numbered
   steps well.
4. **Maintain one canonical example spec**, and delete anything we do not want replicated — agents
   copy the nearest neighbour.
5. **Ban `waitForTimeout` by rule, not by preference.** An agent reaches for it every time a test is
   flaky, because it always appears to work locally.
6. **Bound the test count explicitly** — "the smoke suite is capped at N; adding one requires
   removing one" — because agents optimise for coverage and will happily produce 300 tests.

### 5.13 What we should take, and what we should not

| Take now                                                                            | Take later                                            | Skip — explicitly                                                    |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- |
| **Installed-VSIX activation check** (the launch-arg rewriter with all three guards) | Seeded workspace fixture + `restartVsCode()` boundary | **Second editor adapter** — their clearest negative verdict          |
| **Console-error + `pageerror` assertions**, empty allowlist                         | Component-screenshots home for PR #867                | **Multi-platform VSIX matrix** — we ship one generic VSIX            |
| **Readiness contract in the product** (`data-webview-id` + `data-ready`)            | Per-worker isolation beyond one worker                | **Identity/auth test seams** — ~40% of their complexity, no analogue |
| **Run-scoped isolation module** (incl. the short `u`/`w` dir names)                 | Docs-screenshot project                               | **Test-only inline tree buttons** — one test-only command instead    |
| **Convention scanner, `--strict`, in PR CI** from day one                           | Capability tags beyond the first three                | **In-job parallelism** — their own default is `workers: 1`           |
| **Three tags only**: `@smoke`, `@requires-db`, `@local-only`                        | Nightly issue open/close lifecycle                    | **13-tag taxonomy** — start with 3                                   |
| **Fail-loud CI**: `steps.<id>.outcome` gating, report-existence checks              | Blame-window attribution                              | **Per-worker DB cloning + sharding** — premature at our size         |
| **Build-once-distribute** with post-archive verification                            | Docker image caching                                  | **`restartVsCode()` mid-test** — only if we get persistence bugs     |
| **Compose project as teardown source of truth**; seed sentinel                      | —                                                     | **`waitForTimeout` as a habit** — ban it now                         |
| **One test-only command** returning structured state                                | —                                                     | Native-DB harnesses, SSH/SSL fixtures, reusable named profiles       |

**Test-count target: 30–50, not ~294.** At ~40 tests we need none of the four-way sharding, the
two-phase retry, the tolerance classifier or the six-attempt retry budget that Ref1 needs to stay
green. That is the difference between a safety net and a workstream.

### 5.14 Their bundler migration, and what it predicts for ours

Ref1 is not on Webpack or Vite — it bundles the extension host with esbuild (CJS) and the webviews
with esbuild (ESM, code-splitting on), and it migrated to that arrangement recently, from an
**unbundled `tsc` output**. Their build files read as a post-mortem, and four distinct breakages are
documented in comments. Every one is invisible in source mode and fatal in the packaged artifact.

| What broke                                                                  | Root cause                                                                                                    | Our equivalent risk                                                                               |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `const enum` imports failed to resolve                                      | `tsc` inlines const-enum values; esbuild cannot inline them across a `.d.ts` boundary, so it keeps the import | **Identical** — Vite uses esbuild for transforms. Ban them with `isolatedModules` before starting |
| `import.meta.url` became `{}` at init in a CJS bundle, via a transitive dep | The bundler replaces `import.meta` in CJS output; `fileURLToPath(undefined)` throws during activation         | **Inverted** — moving _to_ ESM, `__dirname` / `__filename` / `require.resolve` break instead      |
| An optional guarded `require` crashed activation                            | `try { require('x') } catch {}` for uninstalled packages must be declared `external`                          | **Identical.** We carry 18 externals; audit which are genuinely optional                          |
| Minification renamed a class and a `constructor.name` check started failing | `keepNames` was needed — the failure appeared **only in production builds**                                   | **Identical.** Anything using `fn.name`, `constructor.name` or `error.constructor ===` is at risk |

Plus one trap in the opposite direction: marking a **type-only ambient module** as `external`
converts a compile-time no-op into an unguarded runtime `require` that crashes activation.

**Their most transferable build lesson has nothing to do with the bundler:**

> **Two build modes are a liability.** `tsc` → `out/` for dev and tests, bundler → `dist/` for
> packaging, means **your tests do not run the code you ship**. That is the root cause of every
> item in the table above. If Vite gives us one pipeline for both, take it — that is a bigger win
> than build speed.

Three smaller ones worth adopting regardless: `mainFields: ['module', 'main']` to prefer ESM entry
points from dependencies (Vite does this by default); an explicit, hand-maintained entry-point list
rather than globbing, because it lets you deliberately exclude an entry and document why; and
`metafile: true` from day one, so "why did the bundle grow 400 KB?" is answerable without
archaeology. These are folded into the companion document's Part K.

### 5.15 Consolidated side-by-side

Everything above, in one matrix, plus where our recommendation lands. **"—" means not evidenced**,
not "absent": absence from a source does not prove absence from a repository, and the distinction
matters when reviewing.

**Scale and cost**

| Dimension         | Ref1                                                | Cosmos DB                    | Our target                                     |
| ----------------- | --------------------------------------------------- | ---------------------------- | ---------------------------------------------- |
| E2E started       | Feb 2026                                            | Jun 2026, 6 weeks post-Vite  | Phase 0a pre-migration; suite in Phase 4       |
| Initial landing   | Infra + **154 tests** + CI, ~1 month, ~1 engineer   | 2 specs                      | 1 VSIX activation test + 5 smoke tests         |
| Current size      | 113 spec files, **~294 runnable** (~58 smoke)       | 21 spec files                | **Capped at 30–50**                            |
| Lines of E2E code | **38,877** (~130 per runnable test)                 | not measured                 | ~5,000 at the same density                     |
| Commit velocity   | 81 commits / 8 authors / 6 months, **still rising** | —                            | budget for it; it is the real cost             |
| Backend           | 6 containerised services + SSL/SSH artifacts        | 1 emulator, isolated compose | open question (§6) — possibly none for spec #1 |

**Runtime, isolation, and flake handling**

| Dimension           | Ref1                                                                                   | Cosmos DB                      | Our target                                      |
| ------------------- | -------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------- |
| Editors             | VS Code **+ a second editor** (a VS Code fork)                                         | VS Code only                   | VS Code only                                    |
| Launch              | Playwright `_electron.launch` on a real editor                                         | Same                           | Same                                            |
| Fixture scope       | Worker-scoped                                                                          | Worker-scoped                  | Worker-scoped                                   |
| Run isolation       | `runId` + temp/results/reports + compose project                                       | `runId` + temp/results/reports | Copy Ref1's module near-verbatim                |
| Parallelism default | **`workers: 1`, `fullyParallel: false`** despite building for it                       | 1 worker                       | 1 worker; shard across CI _jobs_ if ever needed |
| Retries             | `--retries=2`, then a **second process** with a wiped user-data dir — up to 6 attempts | —                              | 1 retry; fix or delete, never tolerate          |
| Flake location      | **100% editor launch/teardown** (7-signature regex)                                    | —                              | expect the same; it is inherent to Electron     |
| Tolerated failures  | 6-condition classifier downgrading second-editor failures                              | none                           | **none — never teach CI to ignore red**         |

**Product seams**

| Dimension            | Ref1                                                        | Cosmos DB                                    | Our target                                           |
| -------------------- | ----------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| Test-only commands   | Yes, env var + context key                                  | Yes, `cosmosDB.e2e.*`, env var + context key | **One**, returning structured state                  |
| Test-only UI         | **23 inline tree buttons**, 8 production files              | none evidenced                               | **none**                                             |
| Seam blast radius    | Corrupts hit-testing; drift; ships in the VSIX              | contained                                    | data/service boundary only, scanner-enforced         |
| Readiness contract   | **None** → 115-line frame heuristic, ~17 bespoke predicates | predicate-based, no product marker           | **`data-webview-id` + `data-ready`** — ours to build |
| Activation handshake | Implicit / text-scraped, timeouts swallowed                 | Explicit, before any spec                    | Explicit                                             |

**Webview handling**

| Dimension                    | Ref1                                                  | Cosmos DB                            | Our target                           |
| ---------------------------- | ----------------------------------------------------- | ------------------------------------ | ------------------------------------ |
| Frame selection              | `page.frames()` + 4-signal cascade, no `frameLocator` | predicate over frames                | one helper keyed on the ready marker |
| **Console-error assertions** | **None. Zero listeners.**                             | **`consoleHealth`, empty allowlist** | **From test #1**, empty allowlist    |
| Monaco                       | Real keystrokes; IntelliSense-eats-Enter workaround   | —                                    | `keyboard.insertText` as default     |
| Virtualised grid             | `toPass` + synthetic `scroll` event; "at least N"     | —                                    | copy the patterns verbatim           |
| Failure diagnostics          | Open tabs + frame URLs in the error message           | —                                    | copy                                 |

**Selection, CI, and reporting**

| Dimension               | Ref1                                                     | Cosmos DB                                     | Our target                                     |
| ----------------------- | -------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| Tags                    | **13**, two taxonomies in one namespace                  | **none** — explicitly skipped                 | **3**: `@smoke`, `@requires-db`, `@local-only` |
| `@smoke` policy         | Quota: 2–3 per feature area (~20%)                       | n/a                                           | **"failure means do not ship"**                |
| CI lanes                | PR smoke, nightly ×4 shards ×2 editors, release ×16      | one workflow, Linux + xvfb                    | PR smoke + nightly + VSIX check                |
| **Installed-VSIX lane** | **Yes — but `workflow_dispatch` only**                   | **No**                                        | **Yes, per PR on build-config changes**        |
| Convention scanner      | Yes, ~120 lines, **warning-only by default**             | No                                            | **Yes, `--strict`, from day one**              |
| Build-once-distribute   | Yes, with **post-archive verification**                  | —                                             | Copy, including the post-archive check         |
| Fail-loud gating        | `steps.<id>.outcome` + report-existence checks           | —                                             | Copy                                           |
| Notification lifecycle  | Open/close issues; **failing to notify fails the build** | per-workflow PR comment                       | Later                                          |
| Coverage from E2E       | —                                                        | Yes, collected and aggregated                 | Later                                          |
| Screenshots             | Component + docs projects, **artifacts, not in CI**      | Self-managed capture modes, failure artifacts | Layer B, artifacts, scenarios owned in `dev/`  |

**Build system**

| Dimension                      | Ref1                                                              | Cosmos DB                                    | Our target                      |
| ------------------------------ | ----------------------------------------------------------------- | -------------------------------------------- | ------------------------------- |
| Extension host                 | esbuild → CJS                                                     | Vite → ESM                                   | Vite → ESM                      |
| Webviews                       | esbuild → ESM, code-splitting on                                  | Vite → ESM, `manualChunks`                   | Vite → ESM, `manualChunks`      |
| Module format                  | No `"type": "module"`                                             | `"type": "module"`, `main.mjs`               | ESM                             |
| **Do tests run shipped code?** | **No** — `tsc` → `out/` for tests, bundle → `dist/` for packaging | Yes                                          | **Yes — the point of unifying** |
| Migration outcome              | 4 documented breakage classes, one fix reaching users             | 4 post-migration fixes, 18-day broken window | Phase 0a is the tripwire        |

**How to read the disagreements.** Where Ref1 and Cosmos DB differ, the mature one is not
automatically right. Three rows invert the seniority — console-error assertions, test-only UI
seams, and the readiness contract — and in all three we should follow Cosmos DB or go further.
Three rows favour Ref1 unambiguously: the installed-VSIX lane, the convention scanner, and the
fail-loud CI machinery. The rest are scale artifacts we should simply not buy.

### 5.16 What this report does not tell us

Worth knowing before review, so the gaps are not mistaken for findings.

| Not available                               | Why, and where the answer lives                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Flake **rate**                              | Needs CI run history + auto-filed failure issues over a date range                                             |
| Real wall-clock for any lane                | The ~8 / ~20 min figures are README claims; timeouts are ceilings, not durations                               |
| CI runner-minutes or cost                   | Nothing in-repo tracks it; needs the Actions billing API                                                       |
| Product bugs caught before release          | Needs closed-issue and PR archaeology; deliberately not estimated                                              |
| Which bundler breakages E2E actually caught | Three of the four are activation-time, so _any_ installed-VSIX test would have — but attribution is unverified |
| Maintenance repair vs. feature split        | Needs classifying 81 commits by intent from PR bodies                                                          |
| Whether their scanner runs `--strict` in CI | Not verified in the report                                                                                     |
| Cosmos DB's tag/retry/flake posture         | Not researched to the same depth; the "—" cells above are honest                                               |

Two premises in the original research request also did not survive contact with the repository and
are corrected in §5.1: the initial framework was **154 tests, not 78**, and `resolveE2eWorkers()`
is not where it was assumed to be. If a third premise matters to a decision, verify it the same way.

---

## 6. Recommendation: three layers, clear boundaries

> This chapter sets the layer boundaries and the sequencing. **[Part 7](#7-recommendations--scored-and-not-limited-to-copying)
> is the decision artifact** — every candidate scored on value, complexity and carrying cost, plus an
> architecture neither reference project chose. Read 6 for the shape, 7 for what to approve.

| Layer                                                     | Runtime                     | Answers                                                                            | Cost            | Status                                          |
| --------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------- | --------------- | ----------------------------------------------- |
| **A. Component tests** (Vitest + jsdom + Testing Library) | Node + jsdom                | "Does this component behave?"                                                      | ms              | New — comes free with Vitest                    |
| **B. Visual harness** (#867, rebuilt)                     | Browser, stubbed host       | "Does the UI render correctly in this state, including failure states and themes?" | sub-second      | Unpark **after** Vite                           |
| **C. E2E** (Playwright + real VS Code)                    | Real VS Code + real backend | "Does it actually work when shipped?"                                              | seconds–minutes | Build **after** the migration, on the new stack |

Plus the Extension Host **integration** layer (`npm test`), which is currently a no-op and is
covered in the companion document.

### Sequencing

**E2E as a _suite_ comes after the migration. One narrow slice of it comes before.** That second
half is new, and it is the only place where the Ref1 report actively contradicts our earlier
sequencing — deliberately, and with the strongest argument it makes anywhere.

The Cosmos DB timeline remains the evidence for the first half:

| Date       | Event                                                                |
| ---------- | -------------------------------------------------------------------- |
| 2026-04-30 | Vite becomes the default build (#2999)                               |
| 2026-05-18 | Production webview rendering fixed after **18 days** broken (#3037)  |
| 2026-05-19 | First releases since the migration: `v0.32.1`, `v0.32.2`             |
| 2026-06-10 | Playwright E2E suite lands (#3136) — **6 weeks after the migration** |

No release was tagged during the broken window, and the fix was never backported to a release
branch — **nothing broken ever shipped**, and they had no E2E at the time. Building a full suite
first would also mean building part of it against the outgoing stack: `globalSetup`'s build
invocation is bundler-specific, and the #867 harness is deeply stack-coupled.

The real lesson from those 18 days is narrower and cheaper to act on: **PR #3037 is titled
"restore _production_ rendering"** — dev mode was fine throughout. The bug was invisible to F5.

**Ref1 supplies the second half, and it is worth taking.** Bundler migrations break at _packaging_
time, not at _source_ time. Their own esbuild migration produced four distinct breakages, every one
of which is invisible to a source-mode test and fatal in the packaged artifact (§5.14). Their lane
that would have caught them is dispatch-only, so it never ran on the change that needed it.

We do not need an E2E _suite_ to close that gap. We need **one test**, roughly 150 lines:

1. Package the extension.
2. Install the VSIX into a temp extensions dir via the VS Code CLI.
3. Launch VS Code with `--extensions-dir=<temp>` and **no** `--extensionDevelopmentPath`.
4. Assert the extension activated and one command is registered.
5. Assert zero console errors.

Copy the launch-arg rewriter verbatim — the "must not fall back to source" guard is the reason this
test cannot lie to us (§5.4). It is a tripwire under the entire migration, and unlike a manual
checklist it runs on every PR that touches build configuration.

1. **Phase 0a — the installed-VSIX activation check.** One automated test plus console-error
   assertions. Runs on PRs touching build config. Not a suite; a tripwire.
2. **Phase 0b — the written manual checklist**, run against a **packaged VSIX**, not F5. Covers what
   one activation test cannot: rendering, styling, Monaco workers, lazy chunks. See the companion
   document's Phase 0 table.
3. **Migrate** (ESM + Vite + Vitest).
4. **Layer C** — Extension Host integration tests, then Playwright smoke, built on the new stack.
5. **Layer B** — unpark #867 on `vite serve` with typed fixtures.
6. **Grow both suites** feature by feature, as Cosmos DB did (2 specs → 21), capped at 30–50 E2E
   tests.

> **Why 0a is worth building on the outgoing stack**, when we rejected that reasoning for Webpack
> code-splitting: the packaging + install + launch + activate path is **bundler-agnostic**. It
> asserts on a VSIX, not on a build config. Nothing in it is thrown away by the migration — which is
> exactly what made the code-splitting work throwaway and this work not.

> **Caveat on the Cosmos DB precedent.** They got away with it partly because someone eventually
> built a production bundle and noticed. Phase 0a makes that deterministic rather than lucky, and
> manual verification stops scaling once the webview surface grows much past four panels.

### Copy from Cosmos DB verbatim

- Worker-scoped `vscodeApp`/`vscodeWindow` fixtures + `closeAllEditorTabs` in `afterEach`
- **`consoleHealth` with an empty allowlist** — arguably their best idea, confirmed by Ref1's
  _absence_ of it (§5.5), and it applies to Layer B as well as C
- Activation handshake before any spec runs
- `runId`-scoped temp/results/reports directories
- Build-mode marker in the staleness check (their #3164 lesson — do not rediscover it)
- Test-only commands gated by an env var **and** a context key
- Self-managed screenshot/trace capture with env-var modes
- Separate Docker compose project and ports for any test backend

### Add from Ref1 (§5)

- **Installed-VSIX activation check, before the migration** — the highest-value single item, and the
  one place the Ref1 report overrides our earlier sequencing. It catches the exact bug class the
  migration is most likely to introduce, and nothing in it is invalidated by the migration
- **Console-error and `pageerror` assertions from test #1**, with a small justified allowlist — Ref1
  has none, and calls that its own biggest gap
- **A readiness contract in the product** (`data-webview-id` + `data-ready`), plus **one** test-only
  command returning structured state. ~60 lines of product code that permanently deletes several
  hundred lines of test heuristics
- **A convention scanner script, `--strict`, in PR CI from day one** — machine-enforced E2E rules,
  which matters disproportionately when specs are written by agents
- **Three tags** (`@smoke`, `@requires-db`, `@local-only`) driving a smoke/nightly split, with
  `@smoke` meaning "failure means do not ship" rather than a per-feature quota
- **Fail-loud CI**: the CI system's own step outcome rather than a shell-written exit code; missing
  reports must fail aggregation; and the two guards that fail the build when the _notification_ path
  itself fails
- **Build-once-distribute with post-archive verification** — re-read the archive to prove the
  critical paths are inside it
- **Compose project as the teardown source of truth**, so cleanup never depends on a transient flag
  and never touches unrelated developer containers
- **Seed sentinel** if we seed a database for Layer C
- For Layer B, **put scenario ownership in `dev/`**, keep the test code as a capture adapter, and use
  `as const satisfies` + `satisfies Record<ScenarioId, …>` + a load-time registry-drift assertion

### Fix in #867 before unparking

> Expanded, with sources and scores, in [§4.2–§4.5](#42-what-the-research-solves-outright).

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

## 7. Recommendations — scored, and not limited to copying

> **Premise of this chapter.** Neither reference project is a template. Ref1's architecture is a
> correct solution to _Ref1's_ constraints, and we share almost none of them. What follows scores
> each candidate on its merits for **our** repository, names the places where the more mature
> project is the worse guide, and puts forward an option that neither project took.

### 7.0 How to read the scores

Three axes, because the central finding of this research is that **build cost and carrying cost are
different numbers**, and only one of them is bounded.

| Axis           | Scale                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Value**      | **High** — prevents a defect class that would otherwise reach users, or unblocks everything downstream · **Medium** — materially reduces cost or catches real bugs · **Low** — quality-of-life · **Negative** — costs more than it returns |
| **Complexity** | **S** — one file or one config; no product code, no CI change · **M** — several files, or touches product code or CI, but self-contained · **L** — cross-cutting: product + tests + CI, or a new subsystem                                 |
| **Carry**      | **None** — write once · **Low** — occasional repair · **Ongoing** — grows with the product, the editor, or the test count                                                                                                                  |

Scores are relative to **this** repository: four webviews, a typed tRPC-style bridge that we own and
publish, no tests today, one generic VSIX, no identity story, one editor target, and implementation
work executed by coding agents. Change any of those and the scores move.

### 7.1 Where maturity is the wrong guide

Ref1 is four months and an order of magnitude ahead of Cosmos DB. On four questions it is **behind**,
and following it would make us worse.

| Question                 | Ref1 (mature)                                             | Cosmos DB (younger)              | What we should do                | Why maturity lost                                                                                                    |
| ------------------------ | --------------------------------------------------------- | -------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Console-error assertions | **None. Zero listeners.**                                 | `consoleHealth`, empty allowlist | Adopt from test #1               | The suite predates the practice and now carries too much accumulated noise to retrofit cheaply. Age is the liability |
| Readiness contract       | **None** → 115-line heuristic, ~17 predicates             | Predicate-based, no marker       | `data-webview-id` + `data-ready` | They could not retrofit a product change across ~25 entry points. We have four, and none written yet                 |
| Test seams               | 23 inline buttons across 8 production files               | Test-only commands only          | **One** command, no UI seam      | The seam was cheap when added and compounded for nine months. Being early is precisely what made it expensive        |
| In-job parallelism       | Built worker isolation + DB cloning, then **disabled it** | Never built it                   | Never build it                   | The mature project's shipped default _is_ the junior project's default. The investment was the mistake               |

**The general rule.** Maturity is evidence about what a system converges to **under its own
constraints** — not about what is right. Roughly 60% of Ref1 exists for identity, provisioning,
multi-platform packaging and a second editor. We have none of those. Copying its architecture
imports solutions to problems we do not own, and the carrying cost is the part that never amortises.

### 7.2 The option neither project took — invert the pyramid

Both projects made **Playwright driving a real Electron editor** the primary vehicle, and everything
else a supporting act. That is the assumption worth attacking, and the evidence for attacking it
comes from their own repositories.

1. **Ref1's flake taxonomy is 100% editor launch and teardown** — not one signature is a selector, an
   assertion or the database. The cost driver is process lifecycle, and it scales linearly with the
   number of Electron tests.
2. **~130 lines carried per runnable test**, and the expensive ones are the Electron ones.
3. **The bug that survived 18 days in Cosmos DB was a packaging / first-render bug.** A larger
   feature-spec suite would not have caught it sooner; one packaged smoke test would have.
4. **Neither project has a typed RPC layer.** Both hand-roll postMessage envelopes, so the only place
   they _can_ assert behaviour is the DOM. **We own `@microsoft/vscode-ext-webview`** — we can assert
   at the bridge, in Node, in milliseconds. That option is genuinely unavailable to them, which is
   why neither report considers it.

**The shape that follows from those four facts:**

| Layer                         | Vehicle                                                  | Covers                                                                                                 | Count   | Cost       |
| ----------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------- | ---------- |
| 1. Bridge contract tests      | Vitest; router invoked directly against a fake transport | Every procedure: happy path, error propagation host→webview, cancellation/`AbortSignal`, concurrency   | most    | ms         |
| 2. Host integration tests     | VS Code's own runner (`@vscode/test-cli`), no Playwright | Commands, tree, storage, settings scopes, connection lifecycle, activation                             | tens    | seconds    |
| 3. Webview UI                 | #867 harness on `vite serve`, typed fixtures             | Rendering, layout, Fluent styling, themes, **failure and empty states**                                | tens    | sub-second |
| 4. Packaged-artifact tripwire | Playwright + Electron, **installed VSIX only**           | Activation, each webview reaches `data-ready`, zero console errors, real CSP / workers / assets / l10n | **1–5** | minutes    |

**Layer 4 is where the two reference projects put ~294 and 21 tests respectively. We would put about
five.**

**What it buys:**

- The flake source is bounded **by construction** — five Electron launches, not 294. No sharding, no
  two-phase retry, no wiped-user-data second pass, no tolerance classifier, no per-worker DB cloning.
  All of that machinery exists in Ref1 to survive a problem we would decline to create.
- Failure and edge states become cheap (Layer 3) — the class both real-backend suites structurally
  cannot reach.
- Most assertions run in the same process as the code, so a failure points at a function rather than
  at a frame.

**What it risks, and how each risk is covered:**

| Risk                                                                                                                              | Cover                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Real VS Code" behaviour (CSP, `acquireVsCodeApi`, `l10n_bundle`, worker origin, asset URLs) is exercised only a handful of times | These are **activation and first-render properties**, not per-feature ones. Checking them once per webview per build is sufficient; checking them 294 times is not 294× the confidence |
| Interaction bugs that appear only in the real host (focus, keybindings, native dialogs)                                           | **Genuinely uncovered.** Accept it, and promote a scenario into Layer 4 when a real bug escapes there — the same regression-driven rule as everything else                             |
| Layer 3 fixtures drift into fiction                                                                                               | The flaw #867 documents against itself. Fixed by typing scenarios against the router's inferred output types, so drift is a **compile error**, not a review discipline                 |
| We must build two things neither project has                                                                                      | True, and it is the honest cost: the readiness contract and the fake transport. Both **M**, both one-time, Carry None/Low                                                              |

**Score: Value High · Complexity M · Carry Low.** The two new pieces are smaller than the single
thing we are declining to build.

> **This is the recommendation, and §7.4–§7.7 assume it.** If you prefer the conventional shape,
> nothing in the waves below is wasted — only the Layer 4 count changes, from ~5 to ~40, and with it
> come sharding, retries, and a standing argument about which failures are real.

### 7.3 The shortlist — if you approve only six things

| #   | Item                                                    | Source              | Value | Complexity | Carry | What it prevents                                                         |
| --- | ------------------------------------------------------- | ------------------- | ----- | ---------- | ----- | ------------------------------------------------------------------------ |
| 1   | Packaged-VSIX activation tripwire + launch-arg rewriter | Ref1                | High  | M          | Low   | Shipping a broken bundle; a green build that secretly tested source      |
| 2   | Console-error + `pageerror` assertions, empty allowlist | Cosmos DB           | High  | S          | Low   | Module-resolution and circular-import breakage that DOM assertions pass  |
| 3   | Readiness contract in the product                       | **New** (their gap) | High  | M          | None  | Several hundred lines of frame heuristics, permanently                   |
| 4   | Bridge contract tests via a fake transport              | **New** (ours)      | High  | M          | Low   | Most of our real logic going untested at any price we would pay          |
| 5   | Ban `const enum`; audit ESM hazards before migrating    | Ref1                | High  | S          | None  | Four documented bundler breakage classes                                 |
| 6   | Convention scanner, `--strict`, in PR CI                | Ref1                | High  | M          | Low   | Agent-authored specs quietly diverging from every rule we wrote in prose |

### 7.4 Wave 0 — before the migration

| Item                                                                          | Source      | Value  | Complexity | Carry | Note                                                             |
| ----------------------------------------------------------------------------- | ----------- | ------ | ---------- | ----- | ---------------------------------------------------------------- |
| Packaged-VSIX activation tripwire                                             | Ref1        | High   | M          | Low   | Bundler-agnostic; the migration cannot invalidate it             |
| Launch-arg rewriter with all three guards                                     | Ref1        | High   | S          | None  | Pure function, unit-testable; guard 3 is the one that matters    |
| Console-error + `pageerror` assertions                                        | Cosmos DB   | High   | S          | Low   | Allowlist starts empty and stays honest only if started now      |
| Ban `const enum` (`isolatedModules`)                                          | Ref1        | High   | S          | None  | Otherwise we write their stub plugin                             |
| Audit `__dirname` / `require.resolve` / guarded requires / `constructor.name` | Ref1        | High   | S          | None  | Four greps; each maps to a documented breakage                   |
| Written manual VSIX checklist                                                 | Ours        | Medium | S          | Low   | Covers what one activation test cannot: styling, workers, chunks |
| Unzip the VSIX and diff against the previous version                          | Azure Tools | Medium | S          | None  | Cheap packaging-surprise detector                                |

### 7.5 Wave 1 — instrumentation, then the first tests

Instrumentation first. This is the hour Ref1 did not spend, and every heuristic in their suite is
the interest payment.

| Item                                                        | Source      | Value  | Complexity | Carry | Note                                                             |
| ----------------------------------------------------------- | ----------- | ------ | ---------- | ----- | ---------------------------------------------------------------- |
| `data-webview-id` + `data-ready` on all four roots          | **New**     | High   | M          | None  | `ready` = React mounted **and** first bridge round-trip resolved |
| One test-only command returning structured state            | Both        | High   | S          | Low   | Env var **and** context key. One seam, at the data boundary      |
| Fake transport for the bridge + typed scenario fixtures     | **New**     | High   | M          | Low   | Enables Layers 1 and 3; strictly better than their banner stub   |
| Bridge contract tests                                       | **New**     | High   | M          | Low   | Where our actual complexity lives                                |
| Run-scoped isolation module (incl. the `u`/`w` names)       | Ref1        | High   | S          | None  | Copy near-verbatim; the macOS socket-path limit is real          |
| Worker-scoped fixture + `closeAllEditorTabs` in `afterEach` | Cosmos DB   | High   | M          | Low   | Only needed once Layer 4 exists                                  |
| Activation handshake before any spec                        | Cosmos DB   | High   | S          | None  | Removes a whole class of flake                                   |
| Native-dialog interception                                  | Ref1        | Medium | S          | None  | Six lines; prevents teardown hangs                               |
| `dumpWorkbenchDiagnostics` + tabs/frame-URL failure detail  | Ref1        | Medium | S          | None  | Turns a CI-only launch failure into a one-look diagnosis         |
| Host integration tests (`@vscode/test-cli`)                 | Azure Tools | High   | M          | Low   | Restores a real `npm test`; target the public API surface        |

### 7.6 Wave 2 — CI that cannot lie

| Item                                                  | Source | Value  | Complexity | Carry   | Note                                                               |
| ----------------------------------------------------- | ------ | ------ | ---------- | ------- | ------------------------------------------------------------------ |
| Fail-loud gating on `steps.<id>.outcome`              | Ref1   | High   | S          | None    | Also catches `timeout-minutes`, which an exit-code check misses    |
| Report-existence checks                               | Ref1   | High   | S          | None    | No report is a failure, not an absence of evidence                 |
| Build-once-distribute + **post-archive** verification | Ref1   | High   | M          | Low     | The step everyone skips and the one that saves you                 |
| Convention scanner, `--strict`                        | Ref1   | High   | M          | Low     | Disproportionate value because agents write the specs              |
| Three tags + two grep lanes                           | Ref1   | Medium | S          | Low     | `@smoke` means "do not ship", not a per-area quota                 |
| PR smoke + nightly lanes                              | Both   | High   | M          | Ongoing | The only Ongoing item in Waves 0–2; price it deliberately          |
| Playwright/Docker image caching                       | Ref1   | Low    | S          | Low     | Do it when a lane is actually slow                                 |
| Failure-issue open/close lifecycle + the two guards   | Ref1   | Medium | M          | Low     | Value becomes High the moment nightly exists and nobody watches it |

### 7.7 Wave 3 — depth, driven by real bugs

| Item                                                                         | Source    | Value  | Complexity | Carry  | Note                                                               |
| ---------------------------------------------------------------------------- | --------- | ------ | ---------- | ------ | ------------------------------------------------------------------ |
| Unpark #867 as a **Vite entry + Vitest browser mode** (§4.3 option B)        | Ours      | High   | M          | Low    | One runner, one config; its unique value is failure states         |
| Wire the harness **assertions** into CI; screenshots stay artifacts          | §4.4      | High   | S          | Low    | Neither reference project split this, and both lost the assertions |
| **Mutation test on the suite itself**, as a script not a sentence            | **#867**  | High   | S          | None   | The one practice we would export rather than import (§4.5)         |
| Scenario ownership in `dev/`; `as const satisfies`; registry-drift assertion | Ref1      | Medium | S          | Low    | Three idioms; adopt all three                                      |
| SlickGrid / Monaco interaction patterns                                      | Ref1      | Medium | S          | Low    | Mostly knowledge transfer, not code                                |
| Regression-only growth policy + explicit cap                                 | Ref1      | High   | S          | None   | A written rule is the cheapest High-value item on this page        |
| Seeded workspace fixture + `restartVsCode()`                                 | Ref1      | Medium | M          | Medium | Only if settings-scope or persistence bugs appear                  |
| Coverage collection from E2E                                                 | Cosmos DB | Low    | M          | Low    | Interesting, not load-bearing                                      |
| Docs-screenshot project                                                      | Ref1      | Low    | M          | Low    | Only when the user manual demands it                               |

### 7.8 Deliberately not doing — and what it would have cost

Recording the rejects with scores matters as much as the adoptions: it is what stops each one being
re-proposed every quarter.

| Item                                  | Value        | Complexity | Carry   | Why not                                                                                           |
| ------------------------------------- | ------------ | ---------- | ------- | ------------------------------------------------------------------------------------------------- |
| Second editor adapter                 | Low          | L          | Ongoing | Their clearest negative verdict: ~800 lines, half of nightly CI, failures CI was taught to ignore |
| Multi-platform VSIX matrix            | Low          | L          | Ongoing | We ship one generic VSIX                                                                          |
| Identity / auth test seams            | None for us  | L          | Ongoing | ~40% of their complexity; we have no identity story                                               |
| Test-only inline tree buttons         | **Negative** | M          | Ongoing | Corrupts hit-testing for unrelated tests; ships in the VSIX                                       |
| In-job parallelism                    | Low          | M          | Low     | Their own shipped default is `workers: 1`                                                         |
| Per-worker DB cloning + sharding      | Low          | M          | Low     | Premature at 5–40 tests; irrelevant under §7.2                                                    |
| 13-tag taxonomy                       | Low          | S          | Low     | Two taxonomies in one namespace; start with three                                                 |
| Tolerated-failure classifier          | **Negative** | M          | Ongoing | A machine deciding red is not red, from log-text regex                                            |
| Pixel-diff baselines for webviews     | Low          | M          | Ongoing | Fluent UI + cross-platform font rendering is a known tar pit; both projects chose artifacts       |
| `waitForTimeout` as accepted practice | **Negative** | S          | Ongoing | They ended up counting them because there were too many to remove                                 |
| Native context-menu automation        | Low          | L          | Ongoing | Ref1 tried four approaches and concluded it is not a reliable command path                        |

### 7.9 Roll-up

**Every High-value item in this chapter is S or M.** The only L-complexity work on the critical path
is unifying the build so that tests run the code we ship — and the Vite migration performs that
anyway. The single genuinely large thing either reference project built, the Electron test suite, is
the thing we are declining.

| Wave                              | High-value items | Any L? | Carry introduced      |
| --------------------------------- | ---------------- | ------ | --------------------- |
| 0 — before the migration          | 5                | no     | one manual checklist  |
| 1 — instrumentation + first tests | 8                | no     | none material         |
| 2 — CI                            | 5                | no     | **the nightly lane**  |
| 3 — depth                         | 2                | no     | grows with test count |

**What would invalidate this plan**, and therefore what to watch for:

- We take on a **second editor target** — the adapter abstraction becomes worth building.
- The webview count grows past roughly eight — manual checklists and a five-test Layer 4 stop
  scaling, and capability tags start earning their keep.
- We acquire an **identity story** — a double-gated auth seam becomes necessary, and Ref1's is the
  reference implementation to copy.
- The bridge stops being typed, or moves out of our control — Layers 1 and 3 lose their foundation
  and the conventional Electron-heavy shape becomes the right answer after all.

---

## 8. Bottom line

- Cosmos DB's E2E **does not** already include #867's capability. It reaches states by building
  them for real; #867 reaches them by describing them. Both are legitimate, and neither substitutes
  for the other.
- The instinct that "#867 is for quick dev/agent checks" is correct — but it undersells it. Its
  unique, non-replicable value is **deterministic failure and edge states**, which a real-backend
  suite cannot produce cheaply.
- The parking decision was right, and every reason for it is being resolved by the migration.
  Notably, the migration also **fixes the harness's worst flaw** (untyped, drifting fixtures) by
  making typed fixtures possible. Ref1 independently built the same thing, which settles whether the
  idea is sound — while also showing it stays valuable only if it stays small (§5.9).
- **The E2E _suite_ belongs after the migration; one E2E _test_ belongs before it.** The suite-after
  ordering is what the reference project did, and nothing broken shipped in the interim. The
  test-before is Ref1's hardest-defended claim, and it is right: their bundler migration was never
  validated against a packaged artifact, and packaging-time breakage is invisible to both F5 and
  source-mode tests.
- **Cap it.** Ref1 carries ~130 lines of E2E code per runnable test and is still adding commits nine
  months in. Thirty to fifty tests is a safety net; three hundred is a workstream.
- **And do not assume either of them is the shape to copy.** Both made a real Electron editor the
  primary vehicle because neither had a typed bridge to assert against. We do. Inverting the pyramid
  — most assertions at the bridge and in a browser harness, and about five Electron tests against a
  packaged VSIX — targets the one cost driver their own evidence identifies, and declines the only
  genuinely large thing either of them built ([§7.2](#72-the-option-neither-project-took--invert-the-pyramid)).

---

## Appendix — Source trail

**Cosmos DB** (`main` @ `4b1bb6c`): `test/e2e/README.md`, `test/e2e/specs/*` (21 files),
`fixtures/{vscode,webviewHelpers,webviews,consoleHealth,coverage,queryEditor,documentPanel,migration,controlFile}.ts`,
`helpers/{e2eIsolation,workbenchReady,windowLayout,captureMode}.ts`,
`setup/{globalSetup,globalTeardown,emulator,activation,aggregateCoverage}.ts`,
`src/commands/e2eTestCommands/registerE2eTestCommands.ts`, `playwright.config.ts`,
`docker-compose.e2e.yml`, `.github/workflows/e2e.yml`.
Related PRs: #3136 (introduced), #3164 (production-build guard), #3169 (Monaco workers),
#3172 (React component tests).

**Ref1 (internal, redacted):** a ten-chapter, source-quoting architecture report produced for this
analysis, covering isolation, the convention scanner, Playwright config, fixtures, the editor
adapter, the readiness helper, test-only tree actions, the installed-VSIX lane, webview testing,
component screenshots, tags and CI wiring, operating costs, a retrospective, the build system, and
closing advice. The report itself is kept **out of this repository** because it cannot be
sufficiently anonymised; §5 above is the distilled, redacted form. Its own caveats apply and are
reproduced in the §5 preamble: no suite was executed, no CI history was queried, and every figure
requiring either is marked `NOT AVAILABLE` rather than estimated.

**This repo:** [PR #867](https://github.com/microsoft/vscode-documentdb/pull/867) description and
commit list; extracted from #866; label `on-hold`; references
`docs/ai-and-plans/live-preview-playwright-future-work.md` (on `feature/local-quickstart`).
