# Contributing to DocumentDB for VS Code

Thank you for your interest in contributing to the **DocumentDB for VS Code** extension. This guide helps you set up your development environment and configure Visual Studio Code to effectively contribute to the extension.

The document consists of four sections:

1. [Branching Strategy](#1-branching-strategy)
2. [Machine Setup](#2-machine-setup)
3. [VS Code Configuration](#3-vs-code-configuration)
4. [PR Submission Checklist](#4-pr-submission-checklist)

## 1. Branching Strategy

### 1.1 Branch overview

| Branch               | Purpose                                                                      | Lifetime                                     |
| -------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| `main`               | Default trunk. All PRs target it. Always open.                               | Long-lived                                   |
| `release/<X.Y>`      | Stabilization + patch line for one minor release. Cut from `main` at freeze. | Short (days to cut, kept around for patches) |
| `dev/<user>/<topic>` | Personal working branches                                                    | Short                                        |
| `feature/<name>`     | Shared collaboration on large features before they are ready for `main`      | Variable                                     |

### 1.2 GitHub Actions

CI runs automatically on:

- **Push to `main` or `release/**`\*\* — full build, tests, and packaging; build sizes cached for PR comparisons.
- **Pull requests targeting `main`, `release/**`, `dev/**`, or `feature/**`\*\* — full build, tests, packaging, and a code-quality report posted as a PR comment.
- **Manual dispatch** — use `workflow_dispatch` with `enforce_full_run` to run the full pipeline on any branch.

### 1.3 Releases

Releases are cut from a `release/<X.Y>` branch, not from `main` directly:

1. When the team is ready to freeze, a maintainer cuts `release/0.9` from a chosen `main` commit and pushes it.
2. Stabilization (bug fixes only) happens on the release branch. Each fix is opened as a PR to `release/<X.Y>`, reviewed, merged, and immediately forward-merged to `main` so `main` stays up to date.
3. When stable, the maintainer tags `v0.9.0` on the release branch and publishes from that tag.
4. Patch releases (`v0.9.1`, `v0.9.2`, …) tag later commits on the same branch.

**The cut point is the content decision.** If you have a PR you want in the upcoming release, merge it to `main` before the release branch is cut. Once the branch is cut, new PRs merged to `main` target the _next_ release.

> **Example:** The team is preparing v0.9. A contributor submits PR #690 — a small connection timeout fix the team wants to include. The maintainer merges #690 to `main`, then cuts `release/0.9` — the fix is in. At the same time, PR #695 proposes a complex new authentication flow that isn't fully ready. The release branch is cut before #695 merges; #695 lands on `main` afterward and ships in v0.10.

### 1.4 Large features

Large features — those that span multiple PRs, touch core subsystems, or carry meaningful integration risk — live on a `feature/<name>` branch until they are merge-ready as a whole. A maintainer merges individual PRs into the feature branch as work progresses. When the feature is complete and validated end-to-end, a single PR from `feature/<name>` to `main` brings it in.

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

## 2. Machine Setup

> **Platform coverage:** The detailed setup instructions below are written for **Windows + WSL2**. Stub sections for [macOS](#22-macos-pending), [Windows (native)](#23-windows-native-pending), and [plain Linux](#24-linux-pending) are included but not yet filled in; Contributors on those platforms are warmly invited to submit a PR expanding those sections!

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

### 2.3. Windows (native) _(pending)_

> **Help wanted!** If you develop on Windows without WSL2, please consider contributing setup instructions for this section.

---

### 2.4. Linux _(pending)_

> **Help wanted!** If you develop on Linux natively, please consider contributing setup instructions for this section. The WSL2 Ubuntu steps above should translate almost verbatim.

## 3. VS Code Configuration

This section explains how to clone the **DocumentDB for VS Code** repository and set up Visual Studio Code for development and debugging.

### 3.1. Steps to Clone and Set Up Repository

1. Ensure you have completed the [Machine Setup](#2-machine-setup) steps.

2. Fork or directly clone the official repository:
   - [DocumentDB for VS Code (vscode-documentdb)](https://github.com/microsoft/vscode-documentdb)

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

1. Open the cloned repository in VS Code:

```bash
cd ~/vscode-documentdb
code .
```

2. Start debugging the extension:
   - Switch to the `Run and Debug` panel.
   - Select `Launch Extension (webpack)`.
   - Press `F5`.

## 4. PR Submission Checklist

Before opening or marking a pull request as ready for review, **all of the following steps must pass locally**. The same checks run in CI, so catching failures locally saves time.

### 4.1. Localization

If you added, changed, or removed any user-facing string (anything passed to `vscode.l10n.t()`), regenerate the localization bundle:

```bash
npm run l10n
```

Commit any changes to the `l10n/` folder together with your code changes.

### 4.2. Formatting

Run Prettier to ensure all files meet the project's formatting standards:

```bash
npm run prettier-fix
```

Commit any files that Prettier reformats.

### 4.3. Linting

Run ESLint and fix all reported issues before submitting:

```bash
npm run lint
```

### 4.4. Package Verification

Verify the extension can be packaged successfully without errors:

```bash
npm run package
```

This step catches webpack bundling issues and missing assets that unit tests alone won't surface.

---

> **Summary — run these four commands before every PR:**
>
> ```bash
> npm run l10n
> npm run prettier-fix
> npm run lint
> npm run package
> ```

## You're Ready to Contribute! 🎉

You've now successfully set up your development environment and are ready to contribute to **DocumentDB for VS Code**. We appreciate your contributions!
