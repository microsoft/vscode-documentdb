---
feature: docs-site
kind: design
status: active
prs: [420]
created: 2026-10-16
verified: 2026-10-16
code:
    - docs/_config.yml
    - docs/_includes/**
    - docs/_sass/custom/**
    - docs/user-manual.md
    - docs/release-notes.md
    - .github/workflows/deploy-documentation-production.yml
---

# Documentation site (GitHub Pages)

> How `docs/` becomes https://microsoft.github.io/vscode-documentdb/, which theme renders it, and how
> to preview a change locally before it ships.

## Purpose

The public documentation site: the landing page, the user manual and the release notes. This
feature covers the build and the look of that site, not its content.

It is an **interim** solution. The user manual is expected to move to learn.microsoft.com; until
then this site should look good and cost little to maintain. Changes that would make the later move
harder (rewriting content into a site-specific format) are deliberately avoided.

## Code map

| Path                                                                                 | Role                                                                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `.github/workflows/deploy-documentation-production.yml`                              | On push to `main` touching `docs/**`, copies `docs/` to `gh-pages`             |
| `docs/_config.yml`                                                                   | Theme pin, plugins, search, published scope                                    |
| `docs/user-manual.md`, `docs/release-notes.md`                                       | Sidebar section pages; served at `/user-manual/` and `/release-notes/`         |
| `docs/user-manual/{connecting-to-databases,data-management,querying,ai-features}.md` | Category pages grouping the user manual                                        |
| Front matter of each published page                                                  | Sidebar title, parent and order                                                |
| `docs/_includes/head_custom.html`                                                    | Loads the dark stylesheet when the OS prefers dark, and `page-toc.js`          |
| `docs/assets/js/page-toc.js`                                                         | Builds the "On this page" panel from the article's h2/h3 headings              |
| `docs/_includes/title.html`                                                          | Sidebar title: DocumentDB icon (light/dark via `<picture>`) and site name      |
| `docs/favicon.ico`                                                                   | Same favicon as documentdb.io; the theme links it automatically                |
| `docs/assets/images/documentdb-icon-{light,dark}.svg`                                | Copies of `resources/documentdb/documentdb_icon_*.svg` with a `viewBox` added  |
| `docs/_sass/custom/setup.scss`                                                       | Theme variables: Segoe UI, Cascadia Mono, Microsoft blue for links and buttons |
| `docs/_sass/custom/custom.scss`                                                      | CSS after the theme: semibold headings, sidebar title, "On this page" layout   |

## Architecture

```
main (docs/**) --push--> deploy-documentation-production.yml --copy--> gh-pages branch
                                                                            |
                         GitHub Pages "legacy" Jekyll build  <--------------+
                         (github-pages gem: Jekyll 3.10, safe mode)
                         + remote_theme just-the-docs@v0.12.0
                                                                            |
                                              microsoft.github.io/vscode-documentdb
```

- **The theme is not in the repository.** `remote_theme` downloads Just the Docs at the pinned tag
  on every build. The repository holds content plus a few override files.
- **The GitHub workflow does not run Jekyll.** It only copies `docs/` to `gh-pages`. GitHub Pages
  builds that branch itself (`build_type: legacy`), so only the plugins and versions on
  [pages.github.com/versions](https://pages.github.com/versions/) are available.
- **Only `index.md`, `user-manual/` and `release-notes/` are published.** Everything else in
  `docs/` is listed under `exclude` in `_config.yml`. A new top-level file or folder in `docs/` is
  published unless it is added to that list.
- **No PR previews.** They were removed from `main` in `c8ad1900`. Preview locally; see
  [Previewing locally](#previewing-locally).

## How the sidebar is built

Every published page starts with a front matter block; that is the only navigation data:

```yaml
---
title: 'MongoDB Atlas' # sidebar label, breadcrumb and browser tab
parent: 'Service Discovery' # title of the parent page
nav_order: 5 # position among siblings
has_toc: false # only on content pages with children, to skip the auto-generated child list
---
```

The tree mirrors the landing page's table of contents:

```
User Manual                     user-manual.md (served at /user-manual/)
├── Connecting to Databases     user-manual/connecting-to-databases.md
│   ├── Service Discovery       ├── Azure, Kubernetes, MongoDB Atlas, each with sub-pages
│   └── Local Instances         └── ...
├── Data Management             user-manual/data-management.md
├── Querying                    user-manual/querying.md
└── AI Features                 user-manual/ai-features.md
Release Notes                   release-notes.md (child_nav_order: desc, newest first)
```

Rules:

- **Files never move.** External links point at `user-manual/<page>`. The hierarchy lives only in
  front matter, so a page can be re-parented without changing its URL. The four category pages
  are new files.
- **Titles must be unique.** Just the Docs links a child to its parent by title. Sidebar titles
  can be shorter than the page's H1, but they also appear in the browser tab, so they must make
  sense on their own ("Troubleshoot MongoDB Atlas Discovery", not "Troubleshooting").
- **Release notes:** `nav_order` is `major * 1000 + minor * 10` (1.0 is `1000`, 0.11 is `110`).
  The [writing-release-notes](../../../../.github/skills/writing-release-notes/SKILL.md) skill
  includes the header.
- Breadcrumbs replace the old "Back to User Manual" lines, which were removed.

**Adding a user manual page:** create the file with the front matter above, choose the `parent`
from the tree, and add a link to the landing page's table of contents as before. Restart a running
local preview to see it in the sidebar.

When the user manual moves to learn.microsoft.com, the front matter maps to a `TOC.yml` and is
otherwise ignored.

## "On this page" panel

Just the Docs has no right-side table of contents; its only in-page option is a Kramdown `{:toc}`
list inside the article. `assets/js/page-toc.js` adds a panel instead:

- Built in the browser from the article's `h2` and `h3` headings that have an `id`; headings with
  `.no_toc` are skipped. Pages with fewer than three such headings get no panel.
- The first entry, **Introduction**, returns to the top of the page.
- Sticky while scrolling. The highlighted entry is the last heading that has reached the top 40%
  of the viewport, or Introduction before the first one.
- Shown from a 78.5rem (1256px) viewport up. There the main column is widened by 12rem on every
  page, so pages with and without a panel share one layout; `custom.scss` repeats the theme's
  sidebar centering formula with the wider width. Below that width nothing changes.
- No content edits. Several pages still carry a hand-written "Table of Contents" list; it can be
  removed page by page now that the panel exists.

## Dark mode

Just the Docs has no built-in "follow the OS" mode
([issue #234](https://github.com/just-the-docs/just-the-docs/issues/234) is open). The site uses
the light scheme and `head_custom.html` adds the theme's own dark stylesheet with
`media="(prefers-color-scheme: dark)"`. This switches live, needs no JavaScript and does not flash.
There is no manual toggle.

## Styling

Kept small on purpose:

- `_sass/custom/setup.scss` sets theme variables before the color schemes load. Light-scheme
  variables are `!default`, so the brand blue applies in light mode; the dark scheme keeps its own
  lighter link color for contrast.
- `_sass/custom/custom.scss` adds CSS after the theme.

See [Just the Docs customization](https://just-the-docs.com/docs/customization/) for the variables.

## Previewing locally

1. Install Ruby with the DevKit (Windows: `winget install RubyInstallerTeam.RubyWithDevKit.3.3`).
2. Keep a Gemfile **outside** `docs/`, so it is not published:

   ```ruby
   source 'https://rubygems.org'
   gem 'github-pages', group: :jekyll_plugins
   gem 'webrick'
   gem 'tzinfo-data'
   gem 'wdm', '>= 0.1.0', platforms: [:windows]
   ```

3. From the folder holding the Gemfile:

   ```bash
   bundle install
   bundle exec jekyll serve --source <repo>/docs --destination ./_site --livereload
   ```

4. Open http://127.0.0.1:4000/vscode-documentdb/ (note the base URL).

Notes:

- **Windows: pass `--source` with the exact folder casing on disk** (for example `C:\Local\...`, not
  `C:\local\...`). In safe mode, a casing mismatch silently drops `docs/_sass` from the Sass load
  path, and the custom styles disappear without an error. GitHub's build is not affected.
- Restart the server after changing `_config.yml` or adding a page: the sidebar is cached in memory
  (`jekyll-include-cache`), so new pages do not appear in the sidebar on live reload.
- The first build downloads the theme, so it needs network access. A full build takes about
  2 minutes locally, because the nested sidebar is rendered into every page.

## Timeline

| Date       | Change                                                                                   | PR / commit |
| ---------- | ---------------------------------------------------------------------------------------- | ----------- |
| 2025-12-11 | Pages configuration and production/preview workflows added                               | `4eda823c`  |
| 2025-12-11 | Experimental Minima theme, `docs/THEME_CUSTOMIZATION.md`                                 | #420        |
| 2025-12-11 | Preview deployments removed from `main`                                                  | `c8ad1900`  |
| 2026-10-16 | `main` merged into #420, preview workflow change dropped, guide moved here and refreshed | #420        |
| 2026-10-16 | Site limited to `index.md`, `user-manual/` and `release-notes/`                          | #420        |
| 2026-10-16 | Minima replaced by Just the Docs: sidebar, search, OS dark mode, Microsoft styling       | #420        |
| 2026-10-16 | User manual grouped into categories; navigation moved into page front matter             | #420        |
| 2026-10-16 | documentdb.io favicon; DocumentDB icon in the sidebar title, swapping with the OS theme  | #420        |
| 2026-10-16 | "On this page" panel for article sections; landing page links on one line                | #420        |

Details: [01-minima-theme.md](./iterations/01-minima-theme.md),
[02-just-the-docs.md](./iterations/02-just-the-docs.md).

## Decisions

No `decisions.md` yet. The choices are recorded in the iteration files.

## Open gaps

1. **Landing page duplicates the sidebar.** `index.md` still carries the full table of contents and
   its own "DocumentDB for VS Code" heading. It must be kept in sync with the front matter by hand.
2. **Excluded pages return 404 after deploy.** Production currently serves `blog-posts/`,
   `localization` and the data-flow documents. Nothing in the repository, the extension or the
   published pages links to them, but outside bookmarks will break.
3. **Not verified on GitHub.** Everything was checked with a local `github-pages` 232 build, not on
   the live Pages build.
