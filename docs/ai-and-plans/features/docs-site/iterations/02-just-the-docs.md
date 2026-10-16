---
feature: docs-site
kind: iteration
status: active
prs: [420]
created: 2026-10-16
---

# Iteration 02: Just the Docs theme

## Goal

A documentation-style site (sidebar, search) that follows the OS light/dark setting, as an interim
solution until the user manual moves to learn.microsoft.com. Cheap to keep, no content rewrite.

## Theme choice

Operator decision: **Just the Docs**, replacing Minima from [iteration 01](./01-minima-theme.md).
The Minima files were dropped.

Alternatives considered:

- _Chirpy_ (operator's visual preference). Rejected: built around a blog (posts, tags, archives),
  and needs Jekyll 4.3 plus `jekyll-archives`, which the GitHub Pages legacy build does not support.
  It would also require switching publishing to a GitHub Actions build.
- _DocFX modern template_ (closest to learn.microsoft.com: left TOC, right "In this article",
  auto/light/dark). Rejected for now: not Jekyll, needs a .NET build in Actions, a Pages source
  change and `toc.yml` files. Not worth it for an interim site.
- _A Jekyll theme replicating learn.microsoft.com._ None found. Learn's look comes from its internal
  publishing pipeline (`MicrosoftDocs/nosql-docs-pr` has `"template": []` in `docfx.json`).

Just the Docs v0.12.0 works through `remote_theme` on the existing legacy build, so the deploy
workflow is unchanged.

## Work items

1. **Sidebar without content edits.** Titles, parents and order live in `_config.yml` `defaults`;
   two section pages (`user-manual.md`, `release-notes.md`) were added at the `docs/` root.
   - Section pages first sat at `user-manual/index.md`; they then received the folder's
     `parent` default and became their own children, so the sections vanished. Moved to the root.
   - `jekyll-titles-from-headings` was tried and removed: pages start with a "Back to ..." line,
     so the plugin finds no heading. Explicit titles were taken from each page's H1.
   - Six user-manual pages are not in the landing page's table of contents (Atlas and index
     management sub-pages). They are ordered right after their parent page.
2. **OS dark mode.** Just the Docs only offers a fixed `color_scheme` (issue #234 is open). A
   `head_custom.html` link loads the theme's dark stylesheet with
   `media="(prefers-color-scheme: dark)"`. A JavaScript toggle (`jtd.setTheme`) was not chosen:
   it needs a stored preference and flashes on load.
3. **Microsoft styling, kept small.** Segoe UI, Cascadia Mono, `#0067b8` links and buttons in light
   mode, semibold headings. The dark scheme keeps the theme's lighter link color for contrast.
   - Locally the overrides were silently ignored. Cause: the preview passed `--source C:\local\...`
     while the folder is `C:\Local`; in safe mode Jekyll then drops `docs/_sass` from the Sass load
     path. A local-only quirk, documented in the README.
4. **Search, breadcrumbs, GitHub and Marketplace links, "Edit this page on GitHub", back to top.**
   Built-in theme options.

## Outcome

Verified locally with `github-pages` 232 (Jekyll 3.10, safe mode, Ruby 3.3 on Windows):

- Build in about 20 seconds with no warnings.
- Sidebar: Overview, User Manual (30 pages), Release Notes (14, newest first).
- Light and dark rendering follow the emulated OS setting; computed link color, heading weight and
  font family confirmed in both.
- Search returns user manual and release notes results.
- All 24 distinct `microsoft.github.io/vscode-documentdb` URLs used by the README, `package.json`,
  the extension source, the landing page, user manual and release notes return 200. A crawl of the
  built site found 94 distinct internal links, none broken.

Not verified:

- The live GitHub Pages build.
- Mobile layout beyond the theme's defaults.
- Every page visually; spot checks only.
