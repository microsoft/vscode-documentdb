---
name: previewing-docs-site
description: Builds and serves the documentation site (docs/, GitHub Pages with Just the Docs) locally so changes can be reviewed before they ship. Use when asked to preview, render, check or review the docs site, the user manual, release notes or the landing page, or to verify styling, images, light and dark mode, or the sidebar.
---

# Previewing the Docs Site

The site is built by GitHub Pages from `docs/` with the Just the Docs remote theme. There are no hosted
PR previews, so review changes with a local build. Background and site structure:
`docs/ai-and-plans/features/docs-site/README.md`.

## Quick start (Windows)

```powershell
.github/skills/previewing-docs-site/scripts/preview.ps1            # port 4000
.github/skills/previewing-docs-site/scripts/preview.ps1 -Port 4001 # second checkout
```

Open **http://127.0.0.1:4000/vscode-documentdb/** (note the base URL) once the log says
`Server running`. The first build downloads the theme and takes about 2 minutes; later edits
rebuild automatically.

The script keeps everything outside the repository (Gemfile copy, `Gemfile.lock`, `_site`) in
`%TEMP%\vscode-documentdb-docs-preview`, installs gems on first use, and fixes the `--source`
path casing (see Pitfalls).

When an agent runs it, start it as a detached background process and poll the URL until it
returns 200 before opening pages.

## Prerequisites

- Ruby with the DevKit: `winget install RubyInstallerTeam.RubyWithDevKit.3.3`
  (the script also looks in `C:\Ruby33-x64\bin`)
- Network access for the first build (gems and the remote theme)

## macOS and Linux

```bash
mkdir -p /tmp/docs-preview && cp .github/skills/previewing-docs-site/scripts/Gemfile /tmp/docs-preview/
cd /tmp/docs-preview && bundle install
bundle exec jekyll serve --source "$OLDPWD/docs" --destination ./_site --livereload
```

## What to check

- **Light and dark mode.** The site follows the OS color scheme. In a browser, toggle the OS
  setting, or with Playwright use `page.emulateMedia({ colorScheme: 'dark' })`.
- **Theme-aware images.** Every `<picture>` should swap to its `_dark` source in dark mode.
- **Sidebar and "On this page".** New pages appear only after a restart (see Pitfalls).
- **Excluded content.** Only `index.md`, `user-manual/` and `release-notes/` are published; other
  `docs/` content must be listed under `exclude` in `_config.yml`.

## Pitfalls

| Symptom                                      | Cause and fix                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom styles missing, no error              | `--source` casing differs from the disk (e.g. `C:\local` vs `C:\Local`), so `docs/_sass` is dropped. Use the script.                          |
| New page or `_config.yml` change not visible | The sidebar is cached (`jekyll-include-cache`) and config is read once. Stop the server and start it again.                                   |
| `/` returns 404                              | The site lives under `/vscode-documentdb/`.                                                                                                   |
| Port already in use                          | Another preview is running. Use `-Port 4001`, or stop the old `ruby.exe` by its process ID.                                                   |
| Build works locally but not on GitHub        | Pages builds `gh-pages` itself (legacy build), so only plugins listed on pages.github.com/versions work. Keep the Gemfile on `github-pages`. |
