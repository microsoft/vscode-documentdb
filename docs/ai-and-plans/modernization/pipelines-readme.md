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
([build-and-test-stack.md, R6.8](./build-and-test-stack.md#r68-github-actions-and-ado-the-network-isolation-problem-and-what-runs-where)).

Marked facts: [MEASURED] was read from the pipeline files on 2026-09-30. [INFERRED] is reasoning,
not verified. "Planned" rows describe the modernization plan, not today.

## In short

- **GitHub Actions gives PR feedback.** It runs on PRs, installs from **public npmjs**, and has open
  internet access.
- **ADO builds what ships.** Its official build runs only after merge (`pr: none`), installs from
  the **internal feed**, and **signs the VSIX users install**. It can be put under network isolation,
  which blocks anything that downloads at build time.
- **Rule:** a check that needs the internet or a display, or that exists for PR feedback, goes to
  GitHub Actions. A check that needs no network and verifies the shipped artifact goes to ADO,
  before signing.

## 1. Inventory [MEASURED]

### GitHub Actions (`.github/workflows/`)

| Workflow                              | Triggers                                                          | What it does                                                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.yml` ("CI")                     | PRs to `main`, `release/**`, `feature/**`; push to `main`; manual | Build the workspaces, `l10n:check`, lint, Prettier, `jesttest`; an `integration-tests` job that is disabled (`if: false`); build and package a VSIX artifact, with a PR comment |
| `api-extractor.yaml`                  | Push to `main` and `release/**`; PRs                              | Extracts the public API typings                                                                                                                                                 |
| `api-publish.yaml`                    | Manual                                                            | Publishes the API typings package to npm                                                                                                                                        |
| `npm-publish-documentdb-js.yml`       | Manual, one checkbox per package                                  | Publishes the four `@documentdb-js/*` packages to npmjs with provenance                                                                                                         |
| `bump-version-pr.yaml`                | Manual                                                            | Opens the version bump PR after a release                                                                                                                                       |
| `deploy-documentation-production.yml` | Push to `main` touching `docs/**`; manual                         | Deploys the documentation site                                                                                                                                                  |
| `seed-build-cache.yml`                | Manual (`seed` / `verify`)                                        | Build-size cache                                                                                                                                                                |

All of them install from **public npmjs**: there is no `.npmrc` at the repository root.

### Azure DevOps (`.azure-pipelines/`)

All four extend the OneBranch governed templates (`v2/OneBranch.Official.CrossPlat.yml`, or the
NonOfficial variant for non-official runs of the build pipelines).

| Pipeline                   | Triggers                                                        | What it does                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build.yml`                | Push to `main` and `next`. **`pr: none`**                       | `npm ci` from the internal feed, build, package, **sign** the VSIX, verify the signature, stage the artifacts, then a `🧪 Test` step that runs `npm test` (currently a no-op) |
| `release.yml`              | Run by hand, with `publishVersion`; `dryRun` defaults to `true` | Takes the artifacts of the `build.yml` run, validates version and manifest, and **publishes the signed VSIX to the Marketplace**                                              |
| `build-npm-packages.yml`   | `trigger: none`, `pr: none` (manual)                            | Builds the npm packages from the internal feed, runs `npm run test --workspaces`, packs `vscode-ext-webview` and `vscode-ext-webview-fluentui`                                |
| `release-npm-packages.yml` | `trigger: none`, `pr: none` (manual)                            | Publishes the `@microsoft`-scoped packages through ESRP                                                                                                                       |

The internal feed is `msdata/CosmosDB/_packaging/vscode-documentdb`, configured in
`.azure-pipelines/.npmrc`.

## 2. The two differences that matter

### 2.1 Package source: public npmjs versus the internal feed

The internal feed mirrors npmjs, but only serves a new version **after a quarantine period** and
scanning. Combined with `pr: none` on the ADO build, this produces a failure you only see after
merging:

1. A PR adds or bumps a dependency to a version published a few days ago.
2. GitHub Actions installs it from npmjs. Everything is green, and the PR merges.
3. The ADO build on `main` runs `npm ci` against the feed. The feed does not serve that version yet,
   so the official build fails.

Cosmos DB hit exactly this: their dependency update #3272 was reverted in #3281 and relanded as
"feed-safe" versions in #3284. The `flagging-fresh-dependencies` skill in this repo exists for the
same reason. **Planned:** a GitHub Actions check that fails a PR adding a version younger than the
quarantine window, so the failure shows up on the PR instead of on `main`.

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
expect the same requirement to reach us [INFERRED]. Our `🧪 Test` step only passes because
`npm test` does nothing. If `npm test` ever starts VS Code, the official build breaks the day
isolation is enabled. The modernization plan removes that step (Stage 1).

## 3. Where each check runs

**The rule:** ADO produces the shipped artifact from vetted inputs, and checks **that exact
artifact** with checks that need no network. GitHub Actions runs everything that needs the internet
or a display, and everything that exists for PR feedback.

The check names L1 to L3 come from the modernization plan
([build-and-test-stack.md, R6.3](./build-and-test-stack.md#r63-how-we-verify-automatically-the-test-levels)):
L1 inspects the unzipped VSIX against a committed manifest, L2 renders the production webview bundle
in a browser, and L3 installs the VSIX into a downloaded VS Code and checks that it activates.

| Check                                | Today                             | GitHub Actions (planned)                                        | ADO official build (planned) | Why                                                                                    |
| ------------------------------------ | --------------------------------- | --------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------- |
| `npm ci`                             | both                              | public npmjs                                                    | internal feed                | Different sources, see 2.1                                                             |
| Build / type check                   | both                              | yes                                                             | yes                          | ADO must build what it signs                                                           |
| Lint, Prettier, `l10n:check`         | GitHub                            | yes (gate)                                                      | no                           | PR feedback; no effect on the artifact                                                 |
| Unit tests (Jest, later Vitest)      | GitHub; ADO only for npm packages | yes (gate)                                                      | optional                     | Need no network, so they can run in ADO, but GitHub already gates every PR             |
| Package the VSIX                     | both                              | yes (PR artifact, and input to L3)                              | yes (**the one that ships**) |                                                                                        |
| **L1** artifact inspection           | not yet                           | yes                                                             | **yes, before signing**      | Needs no network. Both compare against the **same committed manifest** (see section 4) |
| **L2** production-bundle harness     | not yet                           | later, headless (needs browser binaries)                        | no                           | Browser download                                                                       |
| **L3** installed-VSIX smoke          | not yet                           | yes (gate on PRs that touch build config)                       | **no**                       | Downloads VS Code                                                                      |
| E2E suite (future iteration)         | not yet                           | yes                                                             | no                           | Downloads VS Code, browsers, Docker images                                             |
| `🧪 Test` step (`npm test`, a no-op) | ADO                               | n/a                                                             | **removed**                  | Would break under isolation once `npm test` does something                             |
| Dependency freshness                 | manual (skill)                    | **yes: fail a PR adding a version younger than the quarantine** | implicit (`npm ci` fails)    | Moves the failure from "after merge" to "on the PR"                                    |
| Sign, verify signature, publish      | ADO                               | no                                                              | yes                          |                                                                                        |

## 4. The gap between the two VSIXs, and how to close it

GitHub Actions and ADO each build their **own** VSIX from the same commit. L3 runs on the GitHub one,
but users get the ADO-signed one. Two things close the gap:

1. **Manifest equality.** Both pipelines run L1 against one committed manifest (the file list, and
   sizes within a tolerance). If both pass, the two VSIXs have the same contents.
2. **A release-time step for the operator.** Before approving `release.yml`, download the signed VSIX
   from the ADO `build.yml` run and run `npm run test:vsix -- <signed.vsix>` locally (planned
   script). It takes minutes, and it is the only check that runs on the exact bytes users receive.
   Add it to the release checklist.

## 5. Adding a new check: where does it go?

Ask these in order:

1. **Does it need network access beyond the npm feed** (downloads, Marketplace, Docker, browsers)?
   Then it goes to GitHub Actions only.
2. **Does it need a display or a real VS Code?** Then GitHub Actions only (Linux runners with
   `xvfb-run`).
3. **Does it exist for PR feedback** (lint, formatting, fast tests)? Then GitHub Actions. ADO
   does not run on PRs.
4. **Does it verify the artifact that ships**, with no network? Then run it in ADO **before
   signing**, and in GitHub Actions too, so PRs see failures early.
5. **Does it add a dependency?** Check it against the feed quarantine before merging.

## Sources

- This repo: `.github/workflows/*.yml|yaml`, `.azure-pipelines/*.yml`, `.azure-pipelines/.npmrc`
  (read 2026-09-30).
- Cosmos DB: PRs #3275, #3278, #3280, #3289 (network isolation), #3272, #3281, #3284 (feed-safe
  dependencies), and the comment above the disabled Test step in their `.azure-pipelines/build.yml`.
