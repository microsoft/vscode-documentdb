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

| Path                                                    | Role                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `.github/workflows/deploy-documentation-production.yml` | On push to `main` touching `docs/**`, copies `docs/` to `gh-pages`             |
| `docs/_config.yml`                                      | Theme pin, plugins, search, published scope, **sidebar titles and order**      |
| `docs/user-manual.md`, `docs/release-notes.md`          | Sidebar section pages; served at `/user-manual/` and `/release-notes/`         |
| `docs/_includes/head_custom.html`                       | Loads the dark stylesheet when the OS prefers dark                             |
| `docs/_sass/custom/setup.scss`                          | Theme variables: Segoe UI, Cascadia Mono, Microsoft blue for links and buttons |
| `docs/_sass/custom/custom.scss`                         | CSS after the theme: semibold headings                                         |

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

Content files carry no front matter; all navigation lives in `_config.yml` `defaults`:

- `user-manual/*` gets `parent: User Manual`, `release-notes/*` gets `parent: Release Notes`.
- Each page has an explicit `title` and `nav_order`. The user manual order follows the landing
  page's table of contents; sub-pages (Atlas, index management) sit right after their parent.
  Release notes are newest first.

Titles are explicit because the pages start with a "Back to User Manual" line, not the heading, so
`jekyll-titles-from-headings` cannot find them.

**Adding a page:** add the Markdown file, link it from `index.md` as before, and add a
`defaults` entry with `title` and `nav_order` in `_config.yml`. Without the entry the page is still
published and searchable, but it has no title and appears at the end of the sidebar.

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
- The first build downloads the theme, so it needs network access. A build takes about 20 seconds.

## Timeline

| Date       | Change                                                                                   | PR / commit |
| ---------- | ---------------------------------------------------------------------------------------- | ----------- |
| 2025-12-11 | Pages configuration and production/preview workflows added                               | `4eda823c`  |
| 2025-12-11 | Experimental Minima theme, `docs/THEME_CUSTOMIZATION.md`                                 | #420        |
| 2025-12-11 | Preview deployments removed from `main`                                                  | `c8ad1900`  |
| 2026-10-16 | `main` merged into #420, preview workflow change dropped, guide moved here and refreshed | #420        |
| 2026-10-16 | Site limited to `index.md`, `user-manual/` and `release-notes/`                          | #420        |
| 2026-10-16 | Minima replaced by Just the Docs: sidebar, search, OS dark mode, Microsoft styling       | #420        |

Details: [01-minima-theme.md](./iterations/01-minima-theme.md),
[02-just-the-docs.md](./iterations/02-just-the-docs.md).

## Decisions

No `decisions.md` yet. The choices are recorded in the iteration files.

## Open gaps

1. **Landing page duplicates the sidebar.** `index.md` still carries the full table of contents and
   its own "DocumentDB for VS Code" heading. Harmless; trim it only if it bothers readers.
2. **"Back to ..." lines are redundant.** Every page starts with a "Back to User Manual" line,
   which the breadcrumbs now cover. Left in place to avoid content edits.
3. **Excluded pages return 404 after deploy.** Production currently serves `blog-posts/`,
   `localization` and the data-flow documents. Nothing in the repository, the extension or the
   published pages links to them, but outside bookmarks will break.
4. **Not verified on GitHub.** Everything was checked with a local `github-pages` 232 build, not on
   the live Pages build.
