---
feature: build-and-test-stack
kind: plan
status: active
created: 2026-10-01
---

# Modernization: future work

Items that came up during the modernization planning and were judged **below major** for this
iteration. They are not scheduled. Each entry says where it came from, why it was deferred, and what
would make it worth doing.

The source of most entries is review round 1 (2026-10-01), recorded in
[build-and-test-stack.md, B5](./iterations/01-modernization/build-and-test-stack.md#b5-review-round-1-2026-10-01-findings-operator-decisions-amendments).
Findings below major that were cheap, contradiction-only fixes were corrected in the plan directly and
are not repeated here: F14 (N2 and N3 tracked separately), F15 (webpack configs renamed to `.cjs` if
kept as a fallback), F16 (which checks are CI jobs and which are agent runs), F18 (ARIA header row
wording in the grid plan), and the Stage 6 reviewer part of F20.

## Pipelines and dependencies

### Automated dependency-freshness check (F11)

- **What:** a GitHub Actions job that fails a PR adding a dependency version younger than the 7-day
  internal-feed quarantine. Compare newly introduced transitive versions in the lockfile, and fail on
  incomplete lookups. The `flagging-fresh-dependencies` skill already has machine-readable output and
  failure exit codes.
- **Why deferred:** ADO builds run only when a release is prepared, and the operator prepares them
  from quarantine-clear versions (operator, 2026-10-01). Age is also only a proxy for feed
  availability.
- **Revisit when:** ADO builds start running automatically after merge, or a release build fails on a
  quarantined version.

### Per-file hash comparison between the GitHub and ADO VSIX (F02, alternative fix)

- **What:** extract both VSIXs for the same commit and compare per-file hashes, with an explicit,
  justified list of allowed differences (for example the regenerated `NOTICE.html` and signature
  files).
- **Why deferred:** the plan instead runs L1, L3 and the L2 pass on the ADO artifact itself at release
  time (Stage 6 release steps, [`pipelines.md` §4](./pipelines.md#4-the-gap-between-the-two-vsixs-and-how-to-close-it)), which tests the shipped bytes directly.
- **Revisit when:** the release-time check becomes a burden, or builds turn out to be reproducible
  enough that the comparison is cheap.

### Isolated toolchain preflight in ADO (F11, second half)

- **What:** before relying on the new toolchain in a release build, run a non-official ADO build to
  confirm that Vite, Rolldown and esbuild install and build from the internal feed, with no
  postinstall download. Today this is marked `[INFERRED]` in
  [`pipelines.md` §2.2](./pipelines.md#22-network-isolation-on-the-official-build).
- **Why deferred:** the first release after the modernization will exercise it anyway, and there is
  no release until G6.
- **Revisit when:** preparing the first release build after Stage 6, or if network isolation is
  turned on for our pipeline.

### Rename the required check to `Merge gate` (operator, 2026-10-14)

- **Done on #880, 2026-10-14 (decision 0015).** The operator switched the ruleset to `Merge gate`
  during the G8.5 runs instead of waiting for the merge, so this entry is closed.
- **What:** the `gate` job in `main.yml` (decision 0013) keeps the name `Build & Package` only
  because the branch ruleset requires that name. Rename it to `Merge gate`, and its unrelated-label
  variant to `Merge gate (label event, not run)`; switch the ruleset's required check to
  `Merge gate`. Name chosen by the operator over `Required checks`, `CI gate` (reads "CI / CI
  gate"), `Ready to merge` and `Verdict`.
- **Order:** after #880 merges, in a one-line PR. The operator switches the ruleset just before
  merging that PR. Earlier, every other open PR still runs `main`'s workflow and would be blocked
  by a ruleset that requires the new name, and #880 itself must pass `Build & Package`.
- **Why deferred:** the G8.5 runs on #880 come first (operator: "we'll just do it once other tests
  are done").
- **Revisit when:** #880 has merged.

### Ideas from PR #963 scheduled for later (operator, 2026-10-14)

PR #963 by @guanzhousongmicrosoft parallelized CI on the old stack. Its gate, parallel jobs,
`node_modules` cache, job timeouts, read-only default token, every-declared-command check, Docker
test fixes and Dependabot entry were taken over on #880 (decision 0014). These three wait:

- **Database integration tests** against a DocumentDB Local service container, for
  `ClustersClient` and the shell runtime. The first CI coverage against a real database. Costs an
  image pull per run, a flake source and an image tag to keep current. **Revisit in** the E2E
  iteration, which plans Docker anyway.
- **Commit the public API report and fail CI when it changes** (api-extractor). Makes every public
  API change visible in review; API PRs must regenerate the report. Independent of the stack;
  **revisit** any time, it can land on `main` directly.
- **Run the unit tests on Windows in the ADO release build**, as a warning until they pass. The
  first Windows signal, but only at release time; a GitHub `windows-latest` job would be earlier and
  slower. **Revisit** with the platform checks (F12) below.

## Verification depth

### Platform checks before G6 (F12)

- **What:** Windows and macOS spot checks at the risky stages (S3, S4, S5) instead of only at G6:
  package scripts, worker paths, asset URLs, native optional dependencies. Note that the ADO release
  build packages on Windows, while GitHub CI runs Linux.
- **Why deferred:** all stages stay on one branch and one PR that merges after G6 (operator,
  2026-10-01), so no intermediate stage
  ships on its own. G6 covers the platforms before the only release.
- **Revisit when:** stages start merging to `main` separately, or a stage touches platform-specific paths
  heavily enough that finding a problem at G6 would mean redoing that stage.

### Discriminating checks for `keepNames`, telemetry and TypeScript 6 (F17)

- **What:**
  - Pin the minifier's name-preservation option, and assert one representative name-dependent
    behavior in minified output (`RemoveMeBaseCachedBranchDataProvider` uses `constructor.name`).
  - Capture a known telemetry event from the packaged build, beyond the manual `DEBUGTELEMETRY` check
    in G5.
  - Run all package builds and declaration-consumer checks under TypeScript 6, keeping the packages'
    separate `NodeNext` configuration.
- **Why deferred:** G5 checks telemetry by hand, and the TypeScript 6 bump is the last step of Stage 6
  with all builds as its gate. The reviewer found no intrinsic TS6 and `NodeNext` incompatibility.
- **Revisit when:** Stage 5 starts (the name check is cheap to add to L1 then), or a name-dependent bug
  appears.

## Planning hygiene

### Clean up statements in the older sections that the execution plan superseded (F21)

- **What:**
  - The old "How you will know it worked" list says `npm test` runs Extension Host tests.
  - K.4 #33 forbids any `--extensionDevelopmentPath`, but L3 needs one for the probe extension.
    Reword it to: only the probe may be a development path, and the target extension must come from
    the installed VSIX.
  - The Rev 6 decision-log row sits apart from its table.
- **Why deferred:** the execution plan states that it overrides the older sections on sequencing and scope, so a
  reader is not misled about what to do. These are wording fixes.
- **Revisit when:** next editing those sections, or before Stage 0 hands the plan to an implementing
  agent.

### Benchmark the model recommendations (F20)

- **What:** the per-stage model picks rest on vendor descriptions and per-token prices, not on runs
  in this repository. Benchmark representative tasks (for example the Stage 0 L1 script, or one
  Stage 2 batch) on defects found, retries, operator effort and total cost.
- **Why deferred:** the picks are provisional routing suggestions, and Stage 0 and Stage 1 already
  allow a head-to-head trial.
- **Revisit when:** a stage's author model struggles, or the model list changes.

## SlickGrid removal plan

### Split grid tests between jsdom and the browser harness; agree on budgets (F19)

- **What:** in [slickgrid-removal.md](../data-grid/slickgrid-removal.md):
  - **G3:** keep callback and state tests in jsdom; move resizing, virtualization, text selection
    and scrolling to the L2 browser harness. Mocked geometry does not verify them.
  - **G5:** "no horizontal overflow" should mean no **page** overflow. The grid itself may scroll
    horizontally: 50 columns at a 100 px minimum cannot fit.
  - **G4:** agree first-render and scroll performance budgets before comparing candidates.
- **Why deferred:** the grid replacement is a later iteration, and these refine its plan rather than
  this one.
- **Revisit when:** the grid iteration starts.
