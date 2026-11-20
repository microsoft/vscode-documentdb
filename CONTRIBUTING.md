# Contributing to the DocumentDB extension for Visual Studio Code

Thank you for your interest in contributing to the **DocumentDB extension for Visual Studio Code**. This guide helps you set up your development environment and configure Visual Studio Code to effectively contribute to the extension.

> **Product name:** in docs and announcements, use **DocumentDB extension for Visual Studio Code** on first mention, then "the extension". In the product UI, the extension is just **DocumentDB**. The old name "DocumentDB for VS Code" is retired. See [Product name](.github/copilot-instructions.md#product-name) for the full rule.

The document consists of seven sections:

1. [Branching Strategy](#1-branching-strategy)
2. [Machine Setup](#2-machine-setup)
3. [VS Code Configuration](#3-vs-code-configuration)
4. [PR Submission Checklist](#4-pr-submission-checklist)
5. [Documenting Work with AI](#5-documenting-work-with-ai)
6. [AI-Assisted Review Workflow](#6-ai-assisted-review-workflow)
7. [Release Process](#7-release-process)

## 1. Branching Strategy

### 1.1 Branch overview

| Branch               | Purpose                                                                                         | Force pushes  | Lifetime                                  |
| -------------------- | ----------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------- |
| `main`               | Default trunk. All PRs target it. Always open. Releases are tagged here.                        | No, protected | Long-lived                                |
| `dev/<user>/<topic>` | Personal working branches                                                                       | Allowed       | Short                                     |
| `feature/<name>`     | Shared collaboration on large features before they are ready for `main`                         | Discouraged   | Variable                                  |
| `release/<X.Y.Z>`    | Created only when a patch must ship while `main` is not releasable. Branched off a release tag. | Discouraged   | Short (deleted after the patch is tagged) |

See [1.6 Force-push policy](#16-force-push-policy) for the rules behind the force-push column.

### 1.2 GitHub Actions

CI runs in tiers (see [decision 0002](docs/ai-and-plans/features/build-and-test-stack/decisions.md)):

- **Draft pull requests** (to `main`, `release/**` or `feature/**`): build, lint, formatting, type checks and unit tests.
- **Ready pull requests, and pushes to `main` or a release branch** (`release/**`): the above, plus packaging, VSIX inspection and activation. Checks of the workspace packages and of the verification tooling run when their files change. Pushes cache build sizes for PR comparisons.
- **Full run on a pull request:** add the `ci:full-requested` label. It runs every check once on the current commit, and the workflow removes the label.
- **Manual dispatch:** `workflow_dispatch` runs every check with `enforce_full_run`, and only the first tier without it.

How to use it:

1. **Open the PR as a draft** while the work is still moving. Every push gets the quick checks, and the automatic Copilot review stays off.
2. **Click Ready for review** when you hand it over. That run, and every push after it, adds the packaging and VSIX checks. The required `Merge gate` check passes only when every check expected for that run passed.
3. **Add the `ci:full-requested` label** when you want every check, regardless of which files changed: for example, after changing CI or build configuration, or before a release. The label works on drafts too. Add it again to repeat the run on a later commit.

Other labels (such as `on-hold`) do not run CI, and the PR keeps its last `Merge gate` result.

Each same-repository pull request gets one CI report comment, updated on every run: which checks ran and why, code quality and build size.

### 1.3 Releases

Releases are tags-first. Normally there are no release branches at all:

1. When the team is ready to release, a maintainer tags a chosen `main` commit, for example `v0.9.0`. Every release has a tag.
2. Later patch releases (`v0.9.1`, `v0.9.2`, and so on) normally tag later commits on `main` in the same way.

The tag is the immutable marker of what shipped, not the publication source: the Marketplace pipeline builds and publishes from a branch — normally `main`, or the `release/<X.Y.Z>` branch when one had to be cut (see [§7.9](#79-publish-to-the-marketplace)). Tag the commit you intend to release, and release from that commit.

A `release/<X.Y.Z>` branch is created for one scenario only: a quick patch release must ship while `main` is not yet in a releasable state. In that case:

1. Branch `release/<X.Y.Z>` off the relevant release tag, **naming the branch for the version it will ship, not for the minor line** — so `release/0.9.1` cut off the `v0.9.0` tag, never `release/0.9`.
2. Apply the patch on that branch and open it as a PR to `release/<X.Y.Z>`.
3. Tag the patch release (`v0.9.1`) on that branch and run the release pipeline against it.
4. Forward-merge the fix back into `main` so `main` stays up to date.
5. Delete the release branch. The tag preserves the release permanently, so deleting the branch is safe and loses nothing. If another patch is needed later, re-branch from the tag.

**The tag is the release.** If you have a PR you want in the upcoming release, merge it to `main` before the release is tagged. Once a version is tagged, new PRs merged to `main` target the _next_ release.

> **Example:** The team is preparing v0.9. A contributor submits PR #690, a small connection timeout fix the team wants to include. The maintainer merges #690 to `main`, then tags `v0.9.0` on that commit, so the fix is in. Later, a critical bug is found but `main` already contains half-finished work for v0.10. The maintainer branches `release/0.9.1` off the `v0.9.0` tag, applies the fix, tags `v0.9.1` from that branch, forward-merges the fix into `main`, and then deletes `release/0.9.1`.

### 1.4 Large features

Large features — those that span multiple PRs, touch core subsystems, or carry meaningful integration risk — live on a `feature/<name>` branch until they are merge-ready as a whole. A maintainer merges individual PRs into the feature branch as work progresses. When the feature is complete and validated end-to-end, a single PR from `feature/<name>` to `main` brings it in.

**Why this helps quality.** The real benefit is that every individual PR against the feature branch receives the full sweep of reviews, the same bar we apply anywhere else. Instead of one massive PR that is hard to review well, the work arrives as scoped, self-contained items that are easy to reason about. By the time the feature branch is ready, each component and contribution has already been reviewed on its own, so we have far more trust in the quality of the whole. The feature branch is still reviewed ahead of merging into `main`, but that final review builds on a foundation of already-vetted pieces rather than starting from scratch. This structure is not a gimmick to keep the process complex, it genuinely helps us keep the product's quality high.

> **Example:** The integrated shell was built across more than 10 dedicated PRs, each reviewed and merged into `feature/shell`. Once the feature was complete and validated as a whole, it landed on `main` in a single PR.

Before opening the final PR from a feature branch to `main`:

- [ ] All sub-tasks complete; no unresolved `TODO` markers in core paths
- [ ] Validated against a packaged VSIX (not only dev mode)
- [ ] Telemetry instrumented
- [ ] CHANGELOG / docs entry drafted
- [ ] Behind a setting (default off) if there is any doubt about stability
- [ ] Author commits to monitoring for fallout for ~1 week after merge

### 1.5 External contributions

All external PRs target `main` and are reviewed at the team's normal pace.

If a PR is approved but the team wants to defer merging — for example, to avoid introducing uncertainty during an ongoing release cycle — a maintainer will:

1. Mark the PR as **Draft**.
2. Apply the **`on-hold`** label.
3. Leave a short comment with the reason and expected timeline, e.g.: _"Approved — holding until v0.9 ships (~2 weeks). No action needed from you."_

To release the hold: remove the `on-hold` label and click **Ready for review**, then merge normally.

### 1.6 Force-push policy

Shared branches are collaboration surfaces, so an uncoordinated force push can destroy a collaborator's work. The rules below reflect that:

- **`dev/*`** (personal working branches): force pushes are **allowed**. This is where individuals work, so rebasing, squashing, and history cleanup are expected.
- **`feature/*`** and **`release/*`** (collaboration branches): force pushes are **discouraged but not blocked**. There are legitimate cases where a force push is needed to clean up history. When one is necessary, it MUST be coordinated with everyone working on that branch first.
- **`main`**: protected. No force pushes. PRs only.

**After a PR receives human review, do not force-push its head branch for routine rebasing, squashing, or history cleanup**, regardless of branch type. Add follow-up commits instead so reviewers can see what is new without re-reviewing work they have already checked. If a force-push is genuinely necessary, coordinate with the reviewers first. Afterward, leave a brief PR comment identifying what previously reviewed changes stayed unchanged, what changed while resolving conflicts, and what is new since the review.

The relaxed protection on `feature/*` and `release/*` is a deliberate escape hatch, not an invitation.

## 2. Machine Setup

> **Platform coverage:** Setup instructions are available for **Windows + WSL2** and [native Windows](#23-windows-native). [macOS](#22-macos-pending) and [plain Linux](#24-linux-pending) still need platform-specific walkthroughs.

---

### 2.1. Windows + WSL2 _(documented)_

Follow these instructions to configure your machine for JavaScript/TypeScript development using Windows Subsystem for Linux (WSL2) and Visual Studio Code.

#### 2.1.1. Install Ubuntu 22.\* on Windows

- Install **Ubuntu 22.\*** from the Microsoft Store and launch it to configure your Linux user account.
  - Your development environment and tools will reside within `WSL2`.
  - VS Code integrates seamlessly with `WSL2` instances, enabling smooth development from your Windows machine.

#### 2.1.2. Update Ubuntu Packages

Open your Ubuntu terminal and run:

```bash
sudo apt update
sudo apt upgrade
```

#### 2.1.3. Install Node.js with FNM (Fast Node Manager)

`FNM` helps with installing and switching Node.js versions easily. This is useful for testing compatibility across different Node.js versions.

The minimum required versions are **Node.js 22.18.0** and **npm 10.0.0** (see `engines` in `package.json`).

Run the following commands:

```bash
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 22.18.0
fnm use 22.18.0
fnm default 22.18.0
node --version   # should print v22.18.0 or later
npm --version    # should print 10.x or later
```

#### 2.1.4. Install TypeScript Globally (optional)

```bash
npm install -g typescript
```

---

### 2.2. macOS _(pending)_

> **Help wanted!** If you develop on macOS, please consider contributing setup instructions for this section. The general flow (install Node.js via a version manager such as `nvm` or `fnm`, clone the repo, `npm install && npm run build`) should be very similar to the WSL2 path above.

---

### 2.3. Windows (native)

You can develop entirely on Windows, without WSL. The essentials are **Git, Node.js
and VS Code**. If you already have them, most of the setup is done: check their
versions, then skip ahead to cloning and building.

We start with two recommended foundations: a Dev Drive and PowerShell 7. After that,
install only the tools you are missing. Run the commands in a Windows terminal,
not an Ubuntu terminal or a VS Code window connected to WSL.

#### 2.3.1. Recommended: create a Dev Drive

On Windows 11, we recommend a **Dev Drive** for source code and package caches.
This is Microsoft's development-optimized storage volume, using the ReFS filesystem.
Restoring dependencies and building involve many small files; Dev Drive's filesystem
optimizations and lower antivirus scanning overhead can make that work faster.
The improvement depends on the workload, and a Dev Drive is optional.

Throughout this walkthrough, **we use `D:` as the development drive**:
`D:\github\ms\vscode-documentdb` for the checkout and `D:\packages\npm` for npm's cache.
Substitute your own drive or a normal local folder if needed. Keep the checkout
outside OneDrive or other synchronized folders.

To create a new Dev Drive, follow
[Microsoft's Dev Drive setup guide](https://learn.microsoft.com/en-us/windows/dev-drive/):
**Settings > System > Storage > Advanced storage settings > Disks & volumes >
Create dev drive**. It requires administrator permission and at least 50 GB of space.
Keep applications such as VS Code in their normal installation locations. If you
already have a Dev Drive, reuse it; do not reformat an existing drive containing data.
You can check its designation and trust state with this read-only command in an
administrator PowerShell:

```powershell
fsutil devdrv query D:
```

`Access is denied` means the query needs elevation, not that the drive is broken.
A drive label alone does not confirm it is a Dev Drive.

**Defender: use performance mode, not blanket exclusions.** Microsoft's
[Protect Dev Drive using performance mode](https://learn.microsoft.com/en-us/defender-endpoint/microsoft-defender-endpoint-antivirus-performance-mode)
guide explains how Defender can scan asynchronously on a trusted Dev Drive rather
than making file opens wait for scans. This trades some immediate protection for
speed, but retains scanning and is safer than excluding the folder altogether.

Performance mode is enabled by default for a newly created, trusted Dev Drive when
its requirements are met: Defender is the primary antivirus and up to date, and
**real-time protection remains on**. Check **Windows Security > Virus & threat
protection > Manage settings > Dev Drive protection > See volumes**. Follow your
organization's policy on managed machines. There is no need to disable Defender,
detach antivirus filters, or add broad exclusions for this setup.

#### 2.3.2. Install or update PowerShell 7

Windows includes the older **Windows PowerShell 5.1** (`powershell.exe`). We use
**PowerShell 7** (`pwsh.exe`), which installs alongside it. **Check first:**

```powershell
$PSVersionTable | Select-Object PSVersion, PSEdition
```

If you see `7.x` / `Core`, you already have PowerShell 7. If you see `5.1` / `Desktop`,
you are in the older shell. Microsoft's
[Install PowerShell 7 on Windows](https://learn.microsoft.com/en-us/powershell/scripting/install/install-powershell-on-windows)
guide covers the options; **WinGet** is the recommended method for Windows clients.
Install it if missing:

```powershell
winget install --id Microsoft.PowerShell --exact --source winget
```

To update an existing WinGet-managed installation instead:

```powershell
winget upgrade --id Microsoft.PowerShell --exact --source winget
```

If needed, see Microsoft's
[Windows Package Manager installation instructions](https://learn.microsoft.com/en-us/windows/package-manager/winget/#install-winget)
or use the installer linked from the PowerShell guide. Choose a stable, supported
release; see the
[PowerShell support lifecycle](https://learn.microsoft.com/en-us/powershell/scripting/install/powershell-support-lifecycle).

Open **PowerShell 7** from the Start menu afterward and repeat the check. Installing
it does not switch existing terminals. In VS Code, use **Terminal: Select Default
Profile**, choose PowerShell (`pwsh.exe`), and open a new terminal.
For the remaining steps, use a normal terminal, not an administrator terminal.

#### 2.3.3. Git

**Check:** if this prints a Git version, skip installation.

```powershell
git --version
```

**Install if missing:** download [Git for Windows](https://git-scm.com/downloads/win),
or run:

```powershell
winget install --id Git.Git --exact
```

Reopen your terminal after installation, then repeat the check.

#### 2.3.4. Visual Studio Code

**Check:** if you already use VS Code, keep it and check **Help > About**, or run:

```powershell
code --version
```

Use a version satisfying `engines.vscode` in `package.json` (currently 1.109.0 or
later in the 1.x line). **Install if missing:** visit
[code.visualstudio.com](https://code.visualstudio.com/), or run:

```powershell
winget install --id Microsoft.VisualStudioCode --exact
```

Reopen your terminal afterward. If the app is installed but `code` is not recognized,
check that the installer's **Add to PATH** option is enabled.

#### 2.3.5. Node.js and npm: choose one installation method

**Check first:**

```powershell
node --version
npm --version
```

The minimums are currently **Node.js 22.18.0** and **npm 10.0.0**; `package.json`
is authoritative. Node.js includes npm, so you do not need to install npm separately.
If you already have supported versions, skip installation.

**Option A: the regular Windows installer (simplest).** Download the Node.js 22
Windows installer (`.msi`) from [nodejs.org](https://nodejs.org/en/download), choosing
22.18.0 or later in that line and your machine's architecture. Keep npm and PATH
integration enabled. Alternatively, install the Node.js 22 line with WinGet:

```powershell
winget install --id OpenJS.NodeJS.22 --exact
```

Reopen your terminal and repeat the version checks. That's enough to build the
project; a version manager is not required.

<details>
<summary>Option B: fnm (optional; recommended for switching Node.js versions)</summary>

fnm is useful if you work on several projects or want to match CI's version from
[`.nvmrc`](.nvmrc). It adds a little shell setup, so Option A is fine if you do not
need version switching. Choose one method rather than layering both.

Check `fnm --version` first. If it is missing, install it:

```powershell
winget install --id Schniz.fnm --exact
```

Reopen PowerShell, then initialize fnm for this terminal:

```powershell
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
```

The next step selects the repository's Node.js version after cloning.

**For automatic setup in new terminals**, follow
[fnm's PowerShell profile instructions](https://github.com/Schniz/fnm#shell-setup).
Create the profile only if missing, then open it:

```powershell
if (-not (Test-Path $PROFILE)) {
    New-Item -ItemType File -Path $PROFILE -Force
}
notepad $PROFILE
```

Add this line once, save, and open a new terminal:

```powershell
fnm env --use-on-cd --version-file-strategy=recursive --shell powershell | Out-String | Invoke-Expression
```

If fnm is already initialized in a profile, keep the existing setup rather than
adding it twice. Shells started with `-NoProfile` still need explicit initialization.
PowerShell 7 and Windows PowerShell have separate profiles.

</details>

#### 2.3.6. Clone and build

Skip cloning if you already have a native Windows checkout. Skip `mkdir` if the
parent folder already exists. `mkdir` and `cd` work in PowerShell too.

```powershell
mkdir D:\github\ms
cd D:\github\ms
git clone https://github.com/microsoft/vscode-documentdb.git
cd .\vscode-documentdb
```

**Only if you chose fnm**, run these from the repository root. They read `.nvmrc`,
install the requested version if needed, and select it for this terminal:

```powershell
fnm install
fnm use
```

**Everyone:** install the locked dependencies, build, and open VS Code:

```powershell
npm ci
npm run build
code .
```

Run each command after the previous one succeeds. `npm ci` restores the committed
dependencies and replaces an old `node_modules`; stop this checkout's watchers
first. Do not share `node_modules` with WSL.

TypeScript, Vite and Vitest come with the project; no global installation is needed.
Docker/Podman, Azure CLI and Kubernetes tooling are only needed for their respective
features, not the TypeScript build or ordinary unit tests.

To start developing, select **Default: Launch Extension (Vite)** and press **F5**.
The pre-launch task starts the watchers automatically; see
[Launching and Debugging](#32-launching-and-debugging-in-vs-code). A successful
`npm run build` checks types and builds the workspace packages; F5 builds and
launches the development extension. For tests and PR checks, follow
[the PR checklist](#4-pr-submission-checklist).

#### 2.3.7. Optional: put npm's cache on `D:`

Check `npm config get cache` first. If it already points to your Dev Drive, skip
this step. Otherwise, to use `D:\packages\npm` (skip `mkdir` if it already exists):

```powershell
mkdir D:\packages\npm
npm config set cache "D:\packages\npm" --location=user
npm config get cache
```

This user-wide setting moves future downloads to that cache, not Node.js or the
project's installed dependencies. It can be done before the first `npm ci`.
Folder names such as `packages` or `bench` have no special meaning; npm uses the
configured path. Leave existing caches and fnm's installation prefix alone.

<details>
<summary>If something does not work</summary>

| Symptom                                                    | What to try                                                                                                             |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A newly installed command is not recognized                | Reopen the terminal. If needed, fully exit and reopen VS Code so it picks up PATH changes.                              |
| fnm is installed but Node is unavailable                   | Run the fnm initialization line, then `fnm install` and `fnm use` from the checkout.                                    |
| A profile or `npm.ps1` is blocked                          | Check `Get-ExecutionPolicy -List` and follow your organization's policy; do not disable or bypass it.                   |
| Missing modules/types or Vite/Vitest after pulling changes | Run `npm ci` before rebuilding. Do not add individual dependencies or change source types to repair a stale install.    |
| Native binary errors after switching OS                    | Keep Windows and WSL checkouts/dependencies separate and restore on the target OS.                                      |
| `EPERM` or locked files during restore                     | Stop this checkout's watchers and debugging session, then retry.                                                        |
| A package asks for Python or C++ tools                     | Check the package's prebuilt-binary support first; install these tools only if a dependency needs to build from source. |

Do not share an entire `.npmrc` when troubleshooting: it can contain registry credentials.

</details>

---

### 2.4. Linux _(pending)_

> **Help wanted!** If you develop on Linux natively, please consider contributing setup instructions for this section. The WSL2 Ubuntu steps above should translate almost verbatim.

## 3. VS Code Configuration

This section explains how to clone the **DocumentDB extension for Visual Studio Code** repository and set up Visual Studio Code for development and debugging.
Native Windows contributors should use the PowerShell clone/restore commands in
[section 2.3](#23-windows-native) instead of the WSL commands below, then continue
with [Launching and Debugging](#32-launching-and-debugging-in-vs-code).

### 3.1. Steps to Clone and Set Up Repository

1. Ensure you have completed the [Machine Setup](#2-machine-setup) steps.

2. Fork or directly clone the official repository:
   - [DocumentDB extension for Visual Studio Code (vscode-documentdb)](https://github.com/microsoft/vscode-documentdb)

   - Open your **WSL2** terminal and clone the repository:

```bash
cd ~
git clone https://github.com/microsoft/vscode-documentdb
```

3. Install dependencies and build the project:

```bash
cd ~/vscode-documentdb
npm install
npm run build
```

### 3.2. Launching and Debugging in VS Code

To effectively isolate development environments, it is beneficial to create and use a separate VS Code profile.

1. Open the cloned repository in VS Code (from its root on native Windows, run `code .`):

```bash
cd ~/vscode-documentdb
code .
```

2. Start debugging the extension:
   - Switch to the `Run and Debug` panel.
   - Select `Default: Launch Extension (Vite)`.
   - Press `F5`.

The `Watch` task builds the extension host with Vite in watch mode (`npm run watch:ext`) and serves
the webviews with Vite (`npm run watch:views`). No initial webview build is needed. For an on-disk
development build, use `npm run build-dev`. Vite is the only bundler for both targets.
See the [Vite build rationale](build/vite/README.md) for settings, plugins and the checks guarding
the `npm run package` output.

## 4. PR Submission Checklist

There are two cases. Work out which one you are in, then run **only** that list.

| Case                                                                              | Run                                                             |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Case 1 — still working** — any commit, any push, opening or updating a draft PR | The fast loop ([§4.1](#41-case-1--still-working-the-fast-loop)) |
| **Case 2 — handing over** — marking a PR ready for review                         | The full list ([§4.2](#42-case-2--handing-over-the-full-list))  |

A draft PR is **not** a hand-over. It exists to hold commits, CI, and discussion while the work is still moving, so stay on the fast loop until you mark the PR ready for review. If there is no PR at all, the fast loop is the whole list.

### 4.1. Case 1 — still working: the fast loop

```bash
npm run build                     # catches type errors
npx vitest run <path>             # only the tests covering what you touched
```

Nothing else. `l10n`, `prettier-fix`, `lint`, and `package` each cost minutes and say nothing about whether the change is correct.

### 4.2. Case 2 — handing over: the full list

All of these must pass locally. The same checks run in CI, so catching failures here saves time.

```bash
npm run l10n             # only if a vscode.l10n.t() string was added, changed, or removed
npm run prettier-fix
npm run l10n:check       # always; CI validates localization even when generation is skipped
npm run lint
npm run build
npm run typecheck:tests  # strict package-test checks across all workspaces, as in CI
npx vitest run           # full runtime suite; does not replace typecheck:tests
npm run package          # catches bundling and missing-asset failures
```

`npm run build` checks the root project and package source, but does not check package
tests under their stricter `tsconfig.test.json` settings. Vitest runtime success (or
an ad hoc `vitest --typecheck` invocation) is not a substitute for the exact
`npm run typecheck:tests` script. Keep this list aligned with the
[CI static-check job](.github/workflows/main.yml), and report that script's result separately.

Commit whatever these change, including regenerated files under `l10n/` and anything Prettier reformats.

Case 2 is also where the AI pre-review in [§6](#6-ai-assisted-review-workflow) is due. Do not mark a PR ready for human review until that pass has run and its review file is committed under the feature's `iterations/` folder.

### 4.3. Notes on individual steps

- **`npm run l10n`** regenerates the localization bundle from the strings passed to `vscode.l10n.t()`. **Never resolve a conflict in `l10n/bundle.l10n.json` by hand** — the file is generated. Take either side, or delete it, then re-run `npm run l10n` and commit the result.
- **`npm run l10n:check`** validates localization against the source without regenerating files. Run it even when no strings changed, matching CI.
- **`npm run prettier-fix`** covers Markdown as well as source, so documentation formatting does not drift whenever a file is touched. Fenced code blocks are left exactly as authored: they are often partial or illustrative, and reformatting them to the Markdown tab width would leave every example disagreeing with the code it documents.
- **`npm run typecheck:tests`** checks every participating workspace's tests with its own TypeScript configuration, including strict checks that the root build and Vitest runtime do not cover.
- **`npm run package`** catches Vite host and webview bundling issues and missing assets that unit tests alone will not surface.

## 5. Documenting Work with AI

This section is for new contributors, code maintainers, and AI agents. It describes where documentation about work done with AI lives so that decisions and reasoning stay discoverable long after a PR merges.

The canonical location is `docs/ai-and-plans/`. Start at [`docs/ai-and-plans/README.md`](docs/ai-and-plans/README.md), which carries the feature index and the full layout rules.

Durable knowledge belongs to the feature that owns it. Iteration files preserve the plans, reviews, and implementation history of one round of work. Decisions that remain relevant across iterations are recorded in the feature's `decisions.md`. PR and commit links are kept as provenance; the PR number is no longer the navigation key.

### 5.1 Where a document goes

**Almost everything belongs to a feature.**

- **An existing feature** — `docs/ai-and-plans/features/<feature>/`. Durable documents (`design.md`, `decisions.md`, references, `future-work.md`) sit flat at the feature root. The history of one round of work goes in `iterations/NN-slug.md`, or `iterations/NN-slug/` once it grows past roughly three documents. Two documents for one iteration share the number and are told apart by a genre suffix, for example `01-item-counting-tree.md` and `01-item-counting-tree-review.md`.
- **A new feature** — create `docs/ai-and-plans/features/<slug>/` with a `README.md`. Pick a slug a contributor who has never seen the repo would guess; never an abbreviation or an invented umbrella term. Add it to the feature index in the knowledge-base README.
- **A document that touches several features** still belongs to one of them. File it under the feature it is the origin story or the implementation log of, and cross-link the siblings.
- **A document that genuinely belongs to no feature** is a single file at the root of `docs/ai-and-plans/`.

There is no `misc/`, no `general/`, and no bucket folder for "the rest". A folder named for the absence of a property invites exactly the judgment call this layout exists to remove.

Every document under `features/` carries frontmatter with at least `feature`, `kind`, and `status`; root-level documents carry `kind` and `status` only. `code:` globs on durable documents are the only route from a source path back to its rationale; add them where you can.

### 5.2 What a decision record must contain

The decision log must capture decisions **and the reasons behind each decision**. Recording the reasoning shortens review loops: a reviewer, human or agent, who can see why a choice was made often does not need to ask. The code alone is not enough — the context is what makes review efficient.

Entries in `decisions.md` are semantically immutable. Append new entries rather than rewriting old ones, and record a reversal as a new entry plus a status change in the table at the top. The "changed from the proposal?" column is the highest-signal content in the whole knowledge base: it records what the human changed about the agent's proposal.

### 5.3 Draft PRs

Work that is still in progress must be opened as a **draft** pull request. This prevents the automatic GitHub Copilot review from kicking in before it is wanted.

Documents do not wait for a PR number. The feature slug exists before the PR does, so write into the feature folder from the start.

### 5.4 Keep the feature docs current

Update `features/<feature>/README.md` (and `design.md` if applicable) in the same PR when a **decision, constraint, or intended design** changed, or when you already know a current document has become materially misleading. These documents record intent, not exact behavior, so a behavior change on its own is not a trigger.

This is deliberately not mechanical. The usual shape is: a plan is written and records the decisions behind it; the work is done; if it deviates from the plan, the deviation and its reasoning are recorded. Minor choices made along the way do not each need an entry, and no PR needs a proactive sweep for drift.

## 6. AI-Assisted Review Workflow

Contributors are expected to pre-review their own code with AI before requesting human review. The goal is to shorten the human PR-review loop by catching issues earlier. This is the repo maintainer's expectation, not optional polish. The stages below produce a structured review file that is committed into the relevant feature's `iterations/` folder under `docs/ai-and-plans/`.

> **Note:** Some of these prompts will be turned into skills in the near future. They are recorded here now for transparency and to help current contributors.

### 6.1 Stage 1: AI review pass (run by the contributor)

A multi-step review that produces a committed review markdown file stored in `docs/ai-and-plans/features/<feature>/iterations/`:

1. **Initial edge-case review** using a stronger model from one vendor. Every issue gets a severity level. Findings are written to the review markdown file in the feature's `iterations/` folder.
2. **Merge the Copilot reviewer comments.** Pull the GitHub Copilot reviewer's comments from the PR, merge them into the same file, and reassess the severity of each. Keep a link to each reviewer comment so it can be referenced later in follow-up responses.
3. **Validation gate** using a stronger model from a different vendor than the first, at standard context. A 1M or extended context window is not needed here because everything is already scoped at this point, so the standard context window is sufficient. This gate verifies each finding against the codebase to confirm valid vs false positive, reassesses severity, and for each issue proposes one or more solutions with pros and cons and a recommended option. It filters out false assumptions made by the earlier passes.
4. **Independent sweep:** the model looks beyond the captured issues for additional risks not identified earlier, and proposes solutions for them too.

Output: a well-structured review file that must be checked in.

### 6.2 Stage 2: Author decisions

**This is the actual contribution, and it matters most.** The PR author reviews each suggestion in the review file and has the agent record the author's decision, with reasoning, inline in the review file. This is where the author is expected to invest real time. It is what lets future code maintainers understand why decisions were made. Recording these decisions with their reasoning is the maintainer's expectation.

### 6.3 Stage 3: Coding agent implements the fixes

Prompt guidance for the coding agent:

- Report progress inline for each work item.
- If it deviates from the task, document the reasoning.
- Move forward only when confidence is above 80 percent; otherwise stop and ask the operator.
- Commit each work item individually. No mass commits. For each: commit, push, then post a comment in the review markdown file summarizing what was done and why, with a link reference to the commit.
- Post the same comment on GitHub in the PR, one comment per pushed commit.
- If a fix addresses a comment from the Copilot reviewer, post the comment as a reply in the thread of that review.

**Faster with the [`lead`](.github/skills/lead/SKILL.md) skill.** Once the review file records a selected approach for each item, type `/lead` with the advisor model and the review file, for example `/lead advisor: opus docs/ai-and-plans/features/<feature>/iterations/05-review.md`. The session's model becomes the leader: it hands each item to a coding subagent on a cost-appropriate model, runs items that touch different files in parallel, and asks the advisor model for technical judgment. It commits each item separately, records a done note under the item in the review file, and posts a progress checkpoint after every agent return. It asks you before any choice the review file did not settle, and it does not push or comment on GitHub unless you ask. A cost-effective model such as Sol works well as leader, with a stronger model as advisor.

### 6.4 Stage 4: Author final review

- The author reviews the changes. Looking at individual commits is easier, and the review file makes the changes visible.
- Then the author goes to the GitHub review page and ensures everything the Copilot reviewer asked for has been addressed, and resolves those discussions.

This process keeps the quality bar high.

### 6.5 Escape hatch: create issues instead of blocking the PR

For complex problems, or general problems the review discovers, the author is free to ask the agent to create an issue on the repo and summarize it. This makes sense especially for low-severity, nice-to-have items. It lets the PR move forward while keeping track of things that can be done in another iteration, and it is a good source of "good first issue" items for future contributors.

### 6.6 Reviewing UX and workflows with an agent (recommended, under evaluation)

> **Status:** This is a **recommendation**, not a hard rule. The workflow is currently in use and being evaluated, so treat it as a pattern to try and give feedback on rather than a fixed process.

The stages above target code review. UX and workflow review is different: the value comes from actually using the extension and walking real user journeys, not from reading a diff. The pattern is a **person paired with an agent** — you steer and report what you see, the agent verifies each claim against the code and keeps the log.

**Use the [`ux-pr-review`](.github/skills/ux-pr-review/SKILL.md) skill.** Ask an agent to "prepare a UX review for PR #NNN". It owns the procedure, the document template, the status legend, and the worked examples. None of that is repeated here, so there is only one copy to keep correct.

The gist, and the part that is yours rather than the agent's: **a UX review is worth what gets written down.** Every discovery, the decision taken on it, and the **reason** for that decision go into a running log committed to the feature's `iterations/` folder under `docs/ai-and-plans/`. Phase the work by user journey and close each phase out before starting the next, so the log stays readable and the agent's context stays lean. A decision recorded without its rationale gets re-litigated later by someone reading the code and wondering why.

## 7. Release Process

This section is for maintainers cutting a release. It is written so a maintainer, with or without an AI agent, can follow it end to end. The steps assume the release content has already been decided and the relevant PRs are merged to `main` (see [1.3 Releases](#13-releases)).

Throughout, `X.Y.Z` is the version being released, for example `0.9.2`.

### 7.1 Generate the changelog and release notes

Use the `writing-release-notes` skill to produce both the `CHANGELOG.md` entry and the `docs/release-notes/X.Y.md` release notes. The skill knows how to format and split the output; steer it when needed.

Gather the raw material from the milestone for this release:

- **All PRs merged into `main` with milestone `X.Y.Z` attached.**
- **All closed issues assigned to that same milestone.**

Ask the agent to deduplicate and merge the two lists: a single change is often represented by both an issue and its PR, and should appear only once. The skill can process these inputs, but it relies on good source material, so **PRs must have meaningful descriptions.** Thin or empty descriptions produce thin release notes and force manual rewriting.

Review the generated files and edit for accuracy before continuing.

### 7.2 Add screenshots

Release notes carry screenshots; the changelog does not. The `writing-release-notes` skill asks at
the start whether screenshots are planned. If they are, provide the final images and save them under
`docs/release-notes/images/` as `X.Y.Z_feature_name.png`.

The `writing-release-notes` skill owns the exact markup and width conventions (full-width versus
dialog crops); see its `RELEASE-NOTES-FORMAT.md`. Do not hand-write the `<img>` tags.

### 7.3 Commit the notes

Commit the generated `CHANGELOG.md`, `docs/release-notes/X.Y.md`, and any images added in the previous step.

### 7.4 Bump the version

1. Update the `version` field in `package.json` to `X.Y.Z`.
2. Run `npm install` so the lock file (`package-lock.json`) is regenerated with the new version.

Running `npm install` here is required: bumping `package.json` alone leaves the lock file out of sync.

### 7.5 Create the announcement discussion

Based on the `docs/release-notes/X.Y.md` file, announce the release in the **Announcements** category of **Discussions** on the GitHub repo. This is the user-facing announcement for the release.

An agent can do this for you with the `writing-release-notes` skill. The full commands, including how to handle images, are in [ANNOUNCING-ON-DISCUSSIONS.md](.github/skills/writing-release-notes/ANNOUNCING-ON-DISCUSSIONS.md).

Before publishing, the agent must ask whether a placeholder discussion already exists and collect its URL, or confirm a URL already supplied. Wait for the answer and update the confirmed placeholder's title and body. Create a new discussion only when the operator confirms there is no placeholder.

- **Minor or major release (`X.Y.0`):** create or update one discussion titled `DocumentDB extension for Visual Studio Code vX.Y Released! <emoji>` with the release notes as the body. Copy its URL into the `releaseNotesUrl` field in `package.json` so users see the announcement from inside the extension, then pin it in place of the previous announcement.
- **Patch release (`X.Y.Z`):** first create or update the dedicated discussion titled `Patch Release vX.Y.Z 📎` whose body is the `## Patch Release vX.Y.Z` section of the release notes. A patch placeholder is for this dedicated discussion, not the parent announcement. Then post the same text as a comment on the `X.Y.0` announcement of the version being patched. Find that announcement by its title (`vX.Y Released`) and check its content; do not assume it is the one `releaseNotesUrl` points to, because a patch can target an older version. Keep this order: Announcements are listed by most recent activity, so the comment brings the `X.Y.0` announcement back to the top with the patch post right below it. Leave `releaseNotesUrl` unchanged.

### 7.6 Commit the version bump

Commit `package.json`, the updated `package-lock.json`, and any `releaseNotesUrl` change together.

### 7.7 Build the signed artifact

Run the internal Azure DevOps **build** pipeline. It produces a **signed** `.vsix`. Download that artifact.

Always ship the signed artifact from the pipeline. A locally packaged `.vsix` is unsigned and must never be published or attached to a release.

### 7.8 Create the GitHub release

1. Create a release on GitHub with a new tag `vX.Y.Z`, pointing at the release commit on `main`.
2. Use this version's section of `CHANGELOG.md` as the release body.
3. Attach the **signed** `.vsix` downloaded in the previous step.
4. Save the release.

Publishing a stable GitHub release also starts [Bump version after release](.github/workflows/bump-version-pr.yaml).
When its tag matches the version on `main`, the workflow prepares a branch for the next patch's
first development version, for example `1.0.1` → `1.0.2-alpha.0`. It updates `package.json` and
both root version entries in `package-lock.json`, leaving workspace package versions unchanged.
It creates or updates a reminder issue assigned to `tnaum-ms`, with an old/new version table and
a **Create version-bump PR** link that prefills the branch, title, and description.

Open that link and submit the PR yourself so normal pull-request CI runs. Review and merge it
after the required checks pass, then close the reminder issue. The workflow summary also contains
the prepared branch and PR link. No bot-created PR, direct push to `main`, additional credential,
or permission to create PRs is needed; the workflow requires contents and issues write access.
If issue creation fails, the run fails explicitly but the prepared branch and PR link remain
available in the summary. The published release and tag are not modified.
The alpha suffix is for development only; use the intended numeric release version at
[§7.4](#74-bump-the-version) before the next publication.

To catch up after a release, select **Actions → Bump version after release → Run workflow** on
`main`, or run:

```bash
gh workflow run bump-version-pr.yaml --ref main
```

The workflow always operates on `main`. Re-running it reuses the same version-specific branch and
reminder issue while `main` is still on the released version; a prematurely closed reminder is
reopened. Existing matching branches, including a branch pushed by an earlier failed run, are
preserved without force-pushing. Conflicting branch changes cause an explicit failure so a
maintainer can reconcile them. After the bump is merged, the workflow leaves the existing alpha
version alone. GitHub prereleases are ignored, as are releases whose tags do not match the version
on `main` (for example, a patch release from an older release branch).

### 7.9 Publish to the Marketplace

Run the second internal Azure DevOps pipeline, the **release** pipeline, which publishes to the Visual Studio Marketplace from whichever branch holds the release commit — `main` for a normal release, or the `release/<X.Y.Z>` branch when a patch was cut off a tag ([§1.3](#13-releases)). This is a separate pipeline from the build in §7.7: one produces and signs the artifact, the other ships it.

## You're Ready to Contribute! 🎉

You've now successfully set up your development environment and are ready to contribute to the **DocumentDB extension for Visual Studio Code**. We appreciate your contributions!
