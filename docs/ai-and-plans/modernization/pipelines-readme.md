---
kind: notes
status: active
created: 2026-09-30
code:
  - .github/workflows/**
  - .azure-pipelines/**
---

# Pipelines: what runs where, and why

A catch-up guide to this repo's two CI systems, GitHub Actions and Azure DevOps (ADO). It covers the
network isolation constraint on the official ADO build, and the rule for deciding where a new check
belongs. Written during the modernization re-review
([build-and-test-stack.md, execution plan](./build-and-test-stack.md#execution-plan)).

Marked facts: [MEASURED] was read from the pipeline files on 2026-09-30, with checkout, reporting
and artifact wiring updated in Stage 6 on 2026-10-06 and the npm dry-run path on 2026-10-07.
[INFERRED] is reasoning, not verified.
"Planned" rows describe later modernization work. L1 and L3 are wired;
the operator-run ADO build and the G0 manual checklist remain outstanding.

## In short

- **GitHub Actions gives PR feedback.** It runs on PRs, installs from **public npmjs**, and has open
  internet access.
- **ADO builds what ships.** Its official build is run only when a release is being prepared
  (operator, 2026-10-01), installs from the **internal feed**, and **signs the VSIX users install**.
  It can be put under network isolation, which blocks anything that downloads at build time.
- **Rule:** a check that needs the internet or a display, or that exists for PR feedback, goes to
  GitHub Actions. A check that needs no network and verifies the shipped artifact goes to ADO,
  before signing.

## 1. Inventory [MEASURED]

### GitHub Actions (`.github/workflows/`)

| Workflow                              | Triggers                                                          | What it does                                                                                                                                                                      |
| ------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.yml` ("CI")                     | PRs to `main`, `release/**`, `feature/**`; push to `main`; manual | Build the workspaces, `l10n:check`, lint, Prettier, unit tests (`npm test`, Vitest); build and package a VSIX artifact, with a PR comment; L1 inspection and L3 activation/proofs |
| `api-extractor.yaml`                  | Push to `main` and `release/**`; PRs                              | Extracts the public API typings                                                                                                                                                   |
| `api-publish.yaml`                    | Manual                                                            | Publishes the API typings package to npm                                                                                                                                          |
| `npm-publish-documentdb-js.yml`       | Manual; `dry_run` defaults to `true`, one checkbox per package    | Builds/tests/verifies packages and dry-runs publication; explicit real publication to npmjs with provenance requires successful verification and environment approval             |
| `bump-version-pr.yaml`                | Manual                                                            | Opens the version bump PR after a release                                                                                                                                         |
| `deploy-documentation-production.yml` | Push to `main` touching `docs/**`; manual                         | Deploys the documentation site                                                                                                                                                    |
| `seed-build-cache.yml`                | Manual (`seed` / `verify`)                                        | Build-size cache                                                                                                                                                                  |

All of them install from **public npmjs**: there is no `.npmrc` at the repository root.

All four checkouts in `main.yml` use `actions/checkout`'s default ref: GitHub's synthetic
**merge ref for PRs**, and `github.sha` for push/manual runs. Stage 6 restores this policy
for S1-F01 by coordinator decision, reverting Stage 1's temporary PR-head override.
The package, L1 and L3 jobs therefore use the same merge tree as the quality checks, exercising
integration with the base branch rather than just the contributor's head. The seed workflow also
uses the default checkout; no other workflow has the temporary override.

### Azure DevOps (`.azure-pipelines/`)

All four extend the OneBranch governed templates (`v2/OneBranch.Official.CrossPlat.yml`, or the
NonOfficial variant for non-official runs of the build pipelines).

| Pipeline                   | Triggers                                                                                                                              | What it does                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `build.yml`                | YAML declares push to `main` and `next`, `pr: none`. **In practice it is run only when a release is prepared** (operator, 2026-10-01) | `npm ci` from the internal feed, build, package, offline L1 inspection, **sign** the VSIX, verify the signature, stage the artifacts           |
| `release.yml`              | Run by hand, with `publishVersion`; `dryRun` defaults to `true`                                                                       | Takes the artifacts of the `build.yml` run, validates version and manifest, and **publishes the signed VSIX to the Marketplace**               |
| `build-npm-packages.yml`   | `trigger: none`, `pr: none` (manual)                                                                                                  | Builds the npm packages from the internal feed, runs `npm run test --workspaces`, packs `vscode-ext-webview` and `vscode-ext-webview-fluentui` |
| `release-npm-packages.yml` | `trigger: none`, `pr: none` (manual)                                                                                                  | Publishes the `@microsoft`-scoped packages through ESRP                                                                                        |

The internal feed is `msdata/CosmosDB/_packaging/vscode-documentdb`, configured in
`.azure-pipelines/.npmrc`.

## 2. The two differences that matter

### 2.1 Package source: public npmjs versus the internal feed

The internal feed mirrors npmjs, but only serves a new version **after a quarantine period** (7 days
for our ADO pipelines) and scanning. In a repository where ADO builds run automatically after merge,
this produces a failure you only see after merging:

1. A PR adds or bumps a dependency to a version published a few days ago.
2. GitHub Actions installs it from npmjs. Everything is green, and the PR merges.
3. The ADO build on `main` runs `npm ci` against the feed. The feed does not serve that version yet,
   so the official build fails.

Cosmos DB hit exactly this: their dependency update #3272 was reverted in #3281 and relanded as
"feed-safe" versions in #3284. **In this repo the risk is smaller:** the ADO build is only run when a
release is prepared, and the operator prepares those builds from versions already clear of the
quarantine (2026-10-01). The `flagging-fresh-dependencies` skill helps with that preparation. An
automated GitHub Actions freshness check is listed in [future-work.md](./future-work.md), not
planned.

### 2.2 Network isolation on the official build

**What it is.** The Secure Future Initiative requirement SFI ES-4.2.4 asks official build pipelines
to set:

```yaml
networkisolation:
  policy: DefaultDeny
```

With that, the build agent cannot open outbound connections except to approved endpoints: in
practice the internal package feed and the Azure services the pipeline itself needs. The point is
supply chain: the build that produces the **signed** artifact must not pull unvetted code or binaries
from the internet while it runs.

**What it blocks** that a test or build step might want:

- VS Code downloads (`@vscode/test-electron`, from `update.code.visualstudio.com`)
- Marketplace extension installs (`--install-extension <id>`)
- Playwright browser downloads (`npx playwright install`)
- Docker image pulls (emulators, test databases)
- `npx <tool>` for a tool not in the lockfile
- Anything fetched at build time: fonts, remote JSON schemas, scraped docs
- esbuild and Rolldown platform binaries arrive as optional npm packages through the feed, so they
  are fine, as long as no postinstall step downloads anything [INFERRED]

**What happened to Cosmos DB** (same ADO organization and project as ours):

1. #3275 enabled `DefaultDeny` on their `build.yml`.
2. Its `npm test` step starts `@vscode/test-electron`, which downloads VS Code and installs
   `ms-azuretools.vscode-azureresourcegroups` from the Marketplace. Both were blocked
   (`AggregateError [EACCES]`), and the official build failed.
3. #3278 reverted the isolation to unblock releases.
4. #3280 disabled a test step and turned isolation back on, but it disabled the wrong one: a step in
   a shared template used by their non-isolated multi-OS test pipeline.
5. #3289 commented out the Test step in the isolated `build.yml`, with a comment explaining why.
   Their integration tests and E2E suite now gate **only on GitHub Actions**. They did not ask for an
   allowlist exception.

**Where we stand** [MEASURED]: our `build.yml` has **no** `networkisolation` setting today. It lives
in the same ADO organization and project as Cosmos DB's (`msdata/CosmosDB`, from the feed URL), so
expect the same requirement to reach us [INFERRED]. Stage 1 removes the legacy `🧪 Test` step
and points `npm test` at the Jest unit suite (Stage 2 moved it to Vitest); it does not download VS Code. L3 remains on
GitHub Actions, not in the official build, so activation checks do not break an isolated build.

## 3. Where each check runs

**The rule:** ADO produces the shipped artifact from vetted inputs, and checks **that exact
artifact** with checks that need no network. GitHub Actions runs everything that needs the internet
or a display, and everything that exists for PR feedback.

The check names L1 to L3 come from the modernization plan
([build-and-test-stack.md, the automated checks](./build-and-test-stack.md#the-automated-checks)):
L1 inspects the unzipped VSIX against a committed manifest, L2 renders the production webview bundle
in a browser, and L3 installs the VSIX into a downloaded VS Code and checks that it activates.

| Check                               | Today                             | GitHub Actions (planned)                                    | ADO official build (planned) | Why                                                                                                                             |
| ----------------------------------- | --------------------------------- | ----------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                            | both                              | public npmjs                                                | internal feed                | Different sources, see 2.1                                                                                                      |
| Build / type check                  | both                              | yes                                                         | yes                          | ADO must build what it signs                                                                                                    |
| Lint, Prettier, `l10n:check`        | GitHub                            | yes (gate)                                                  | no                           | PR feedback; no effect on the artifact                                                                                          |
| Unit tests (Vitest)                 | GitHub; ADO only for npm packages | yes (gate)                                                  | optional                     | Need no network, so they can run in ADO, but GitHub already gates every PR                                                      |
| `verify:packages` / publish dry-run | GitHub npm publish workflow       | gates the `@documentdb-js/*` publish job; not general PR CI | not wired                    | Packed-test, export/type and consumer checks need public validator downloads; the ADO `@microsoft/*` publish path remains a gap |
| Package the VSIX                    | both                              | yes (PR artifact, and input to L3)                          | yes (**the one that ships**) |                                                                                                                                 |
| **L1** artifact inspection          | implemented; local pass           | wired as a separate job                                     | **wired before signing**     | Needs no network. Rerun on the downloaded ADO artifact at release time (section 4)                                              |
| **L2** production-bundle harness    | integrated-browser pass           | later, headless (needs browser binaries)                    | no                           | Browser download                                                                                                                |
| **L3** installed-VSIX smoke         | implemented; CI proof pending     | wired as a separate job on PRs                              | **no**                       | Downloads VS Code; local machine has no display/Xvfb                                                                            |
| E2E suite (future iteration)        | not yet                           | yes                                                         | no                           | Downloads VS Code, browsers, Docker images                                                                                      |
| Legacy `🧪 Test` step               | removed in Stage 1                | n/a                                                         | **removed**                  | Retired no-op harness; unit tests run on GitHub and L3 must not download VS Code in ADO                                         |
| Dependency freshness                | manual (skill)                    | future work, not planned                                    | implicit (`npm ci` fails)    | Release builds are prepared from quarantine-clear versions (2.1)                                                                |
| Sign, verify signature, publish     | ADO                               | no                                                          | yes                          |                                                                                                                                 |

### 3.1 Reports, artifacts and PR size feedback (Stage 6)

On GitHub Actions, **Build & Package** still depends on **Code Quality & Tests** and produces
`Artifacts-<run_id>` (VSIX/tgz) and `Bundle-reports-<run_id>` (`build/verification/reports/*.json`).
Bundle-report upload uses `if: always()` and treats missing files as an error. **VSIX inspection
(L1)** downloads those two artifacts, runs the offline inspection and rejection proofs, and
uploads `L1-manifest-report-<run_id>` with `if: always()` (missing reports warn, because failures
before size evaluation may not write one). The report contains informational manifest drift and
the enforced per-graph `sizeBudget`; an over-budget inspection writes the report and still
fails the job. **Installed VSIX activation (L3)** independently consumes the VSIX from Build &
Package, runs on GitHub only, and keeps its failure-diagnostics artifact unchanged.

L1 now owns size collection, cache save/restore and the `<!-- build-size-report -->` PR comment.
The shared [report formatter](../../../build/verification/build-size-report.cjs) reads L1's
`sizeBudget.graphs` without reimplementing graph traversal. It reports all five views, the views
entry, both Monaco workers, all host graphs (including `mainStartup`), and the VSIX total, with
exact PR bytes, base bytes, delta and budget status/limit. Shared chunks occur in multiple graphs,
so these rows are not additive. The old `dist/views.js` metric is no longer used as a proxy for
all webviews.

Push builds of `main` cache only successful L1 results, using the unchanged
`build-sizes-<ref>-<sha>` key. The JSON format is now
`{version: 2, vsixSize, graphSizes: {<graph>: <bytes>}}`, including `vsix` in `graphSizes`.
The manual **Build Size Cache** seed mode packages and inspects the selected ref, publishes the
same report artifacts, and uses the same formatter/cache format; verify mode remains a
schema-independent cache lookup, so old entries are still accepted. PR restore tries the exact
base SHA, then the branch prefix. Restored data is renamed before collecting PR sizes, so a miss
cannot accidentally become a PR-as-base comparison.

The PR comment updates its existing marker comment, links the VSIX and both report artifacts,
and runs with `if: always()` even after a budget failure; it does not turn the failed L1 check
green. Legacy `{vsixSize, webviewSize}` cache entries still give a VSIX delta, but explicitly say
per-graph base values are unavailable instead of showing a false reduction. With no base, deltas
are `N/A`; if an earlier invariant prevents the L1 report, the comment says measurements are
unavailable. As before, token-written comments are restricted to same-repository PRs; fork PRs
still get artifacts and job logs. Packaging/L1/L3 run for PRs to `main` or `release/**`, pushes
to `main`, and dispatches on those refs or with `enforce_full_run`; feature-target PRs otherwise
run only quality/tests under the existing job condition.

ADO's unsigned-VSIX inspection uses `--manifest-report` and enforces the same budget **before
signing**. A report-only `CopyFiles@2` step, with `condition: succeededOrFailed()`, stages
`build/verification/l1-manifest-report.json` and `build/verification/reports/*.json` under the
existing OneBranch `ob_outputDirectory`, whose contents are published as pipeline artifacts.
This moves report staging out of the final success-only package-copy step without duplicating
it. A failed inspection still prevents signing and the final package/signature staging; only
diagnostic reports are staged on failure. No signing, feed, pool or release policy changed, and
there is no L3 in ADO. YAML and task ordering were checked locally; the governed template and an
actual ADO run remain operator verification.

### 3.2 `@documentdb-js/*`: safe verification and gated publication

`npm-publish-documentdb-js.yml` remains manual-only. Its `dry_run` input defaults to `true`:

- The **Verify packages (publish dry-run)** job has only `contents: read`, no environment and no
  OIDC permission. It checks out the dispatch commit, selects Node from `.nvmrc`, installs npm
  **11.20.0** and runs `npm ci`, `npm run build --workspaces --if-present`,
  `npm run test --workspaces --if-present`, and `npm run verify:packages`. The latter packs all
  six workspaces and checks packed-test rejection, exports/types and representative consumer
  calls (including rejection controls).
- It then runs `npm publish --dry-run --workspace <package>` for each selected
  `@documentdb-js/*` package. With `dry_run=true` and no package selected, it dry-runs **all four**.
  A dry-run never requires a reviewer to approve an environment, never requests `id-token: write`,
  and never schedules the publish job.
- **Publish to npmjs.com** has `needs: verify` and `if: ${{ !inputs.dry_run }}`. A real-publish
  dispatch must select at least one package; otherwise verification fails before environment
  approval can be requested. The publish job preserves the protected
  `npm-publish-documentdb-js-scope` environment, `id-token: write`, Trusted Publishing and
  per-package `--provenance` publication. It installs/builds again in its own checkout; the
  verifier does not transfer the exact checked tarballs into that job.

The npm pin fixes the September 30 `main` run's `EBADENGINE`: `npm@latest` resolved to npm
12.2.0, requiring Node `^22.22.2 || ^24.15.0 || >=26.0.0`, while `.nvmrc` selected 22.18.0.
npm 11.20.0 supports Trusted Publishing (11.5.1 and later) and Node `^20.17.0 || >=22.9.0`; it
was published on 2026-09-22, outside the seven-day quarantine (review S6-F03: the minimum
version had never published from this workflow). Only the publish job serializes on the
`publish-documentdb-js-packages` concurrency group, so dry runs never queue behind a publish
that awaits approval (S6-F04).

**Operator procedure:** first dispatch with `dry_run=true` on the intended commit and inspect
verification and all selected dry-run results. For the modernization release, publish from
`main` only after merge and the release prerequisites in the execution plan are satisfied:
dispatch with `dry_run=false`, enable the desired `publish_*` checkboxes, wait for verification
to pass, and have an authorized reviewer approve `npm-publish-documentdb-js-scope`. Its branch
protection rules still apply (the September 30 `release/v0.11.0` run was rejected before any
step because that branch was not allowed to deploy).

Before a real dispatch, check the package versions are not already published and confirm each
package's npm Trusted Publisher configuration matches this repository, workflow and environment.
Dry-run success cannot validate OIDC authentication or npm-side publisher settings. Nothing in
this change modifies those settings or environment policy. This closes PR-F02's missing
verification gate for this GitHub publish path, **not** the ADO `@microsoft/*` path or general PR CI.

**Validation (2026-10-07):** branch dry-run
[37618213760](https://github.com/microsoft/vscode-documentdb/actions/runs/37618213760), at
`c0fd83c857855189c941e386080c2ea05a548665`, passed verification and all four publication dry-runs.
The publish job was **skipped**, the pending-deployments API returned `[]`, and registry version
lists were unchanged before and after; no package was published. Real publication was not tested.

## 4. The gap between the two VSIXs, and how to close it

GitHub Actions and ADO each build their **own** VSIX from the same commit. L3 runs on the GitHub one,
but users get the ADO-signed one. An earlier version of this section argued that equal file lists
and similar sizes ("manifest equality") close the gap. They do not: two files of the same size can
contain different code, and ADO also regenerates `NOTICE.html` (review round 1, F02).

**What closes the gap instead:** the checks run on the exact file users receive. Releases are
deliberate, so this is a release-checklist step for the operator:

1. Download the signed VSIX from the ADO `build.yml` run and record its **SHA-256**.
2. Download the matching bundle reports (ADO stages `build/verification/reports/*.json`) and run
   L1 with `npm run verify:vsix -- <signed.vsix> --reports <report-directory>`. Run L3 on that file
   locally (`npm run test:vsix -- <signed.vsix>`), and
   have an agent run the L2 browser pass on its extracted contents.
3. Record the digest and the results in the release approval. Approve `release.yml` only for that
   digest.

Comparing per-file hashes between the GitHub and ADO builds of the same commit is a possible
addition, listed in [future-work.md](./future-work.md); it is not needed while step 2 runs.

## 5. Adding a new check: where does it go?

Ask these in order:

1. **Does it need network access beyond the npm feed** (downloads, Marketplace, Docker, browsers)?
   Then it goes to GitHub Actions only.
2. **Does it need a display or a real VS Code?** Then GitHub Actions only (Linux runners with
   `xvfb-run`).
3. **Does it exist for PR feedback** (lint, formatting, fast tests)? Then GitHub Actions. ADO
   does not run on PRs, and in this repo it only runs for release builds.
4. **Does it verify the artifact that ships**, with no network? Then run it in ADO **before
   signing**, and in GitHub Actions too, so PRs see failures early.
5. **Does it add a dependency?** Before a release build, make sure every version is clear of the
   7-day feed quarantine.

## Sources

- This repo: `.github/workflows/*.yml|yaml`, `.azure-pipelines/*.yml`, `.azure-pipelines/.npmrc`
  (read 2026-09-30).
- Cosmos DB: PRs #3275, #3278, #3280, #3289 (network isolation), #3272, #3281, #3284 (feed-safe
  dependencies), and the comment above the disabled Test step in their `.azure-pipelines/build.yml`.
