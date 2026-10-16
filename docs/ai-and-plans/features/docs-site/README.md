---
feature: docs-site
kind: design
status: active
prs: [420]
created: 2026-10-16
code:
    - docs/_config.yml
    - docs/_includes/**
    - docs/_sass/minima/**
    - docs/assets/css/**
    - .github/workflows/deploy-documentation-production.yml
---

# Documentation site (GitHub Pages)

> How `docs/` becomes https://microsoft.github.io/vscode-documentdb/, which theme renders it, and how
> to preview a change locally before it ships.

## Purpose

The `docs/` folder is published as the public documentation site: the landing page, the user
manual, release notes and blog posts. This feature covers the build and the look of that site, not
its content.

## Code map

| Path                                                    | Role                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `.github/workflows/deploy-documentation-production.yml` | On push to `main` touching `docs/**`, copies `docs/` to `gh-pages`       |
| `docs/_config.yml`                                      | Jekyll configuration: theme, plugins, `baseurl`, Minima options          |
| `docs/assets/css/style.scss`                            | Main stylesheet entry point: imports the skin and Minima, then overrides |
| `docs/_sass/minima/custom-variables.scss`               | Minima hook for Sass variable overrides, loaded before the theme         |
| `docs/_sass/minima/custom-styles.scss`                  | Minima hook for CSS overrides, loaded after the theme                    |
| `docs/_includes/custom-head.html`                       | Minima hook for extra `<head>` content                                   |
| `docs/_includes/sub-footer.html`                        | Minima hook for content before `</body>`                                 |

## Architecture

```
main (docs/**) --push--> deploy-documentation-production.yml --copy--> gh-pages branch
                                                                            |
                         GitHub Pages "legacy" Jekyll build  <--------------+
                         (github-pages gem: Jekyll 3.10, safe mode)
                                                                            |
                                              microsoft.github.io/vscode-documentdb
```

- The repository Pages source is the `gh-pages` branch root, with `build_type: legacy`. GitHub runs
  its own Jekyll build on that branch. Only the plugins and versions listed on
  [pages.github.com/versions](https://pages.github.com/versions/) are available.
- `docs/` is copied as-is with `clean: true`, but the Jekyll build publishes **only `index.md`,
  `user-manual/` and `release-notes/`**. Everything else in `docs/` (`ai-and-plans/`, `blog-posts/`,
  the internal data-flow documents, `localization.md`) is listed under `exclude` in `_config.yml`.
  A new top-level file or folder in `docs/` is published unless it is added to that list.
- The raw `.md` sources of published pages are also served (for example `/index.md`). This is
  GitHub Pages' optional-front-matter behavior and predates this feature.
- There are no PR preview deployments. They were removed from `main` in `c8ad1900` ("simplify github
  pages release (no previews)"). Preview is local; see [design.md](./design.md#previewing-locally).

The theme customization guide is in [design.md](./design.md).

## Timeline

| Date       | Change                                                                                   | PR / commit |
| ---------- | ---------------------------------------------------------------------------------------- | ----------- |
| 2025-12-11 | Pages configuration and production/preview workflows added                               | `4eda823c`  |
| 2025-12-11 | Experimental Minima theme, preview workflow notes, `docs/THEME_CUSTOMIZATION.md`         | #420        |
| 2025-12-11 | Preview deployments removed from `main`                                                  | `c8ad1900`  |
| 2026-10-16 | `main` merged into #420, preview workflow change dropped, guide moved here and refreshed | #420        |
| 2026-10-16 | Site limited to `index.md`, `user-manual/` and `release-notes/`                          | #420        |

Details: [iterations/01-minima-theme.md](./iterations/01-minima-theme.md).

## Decisions

No `decisions.md` yet. The choices made so far are recorded in the iteration file.

## Open gaps

1. **Navigation key mismatch.** The pinned Minima commit `1e8a445` reads `site.header_pages`, but
   `_config.yml` documents `minima.nav_pages`, which only exists on newer Minima `master`. Either
   pin a newer commit or use `header_pages`. Today the header shows only the site title, because no
   published page has a `title` in its front matter.
2. **Minima pin is old.** `1e8a445` (2025-02-27) is about 30 functional commits behind `master`
   (WCAG contrast, mobile navigation, Font Awesome 7). Minima 3.0 is still unreleased.
3. **Duplicate page title.** The landing page renders the site title and the `index.md` H1 one
   after the other.
4. **Excluded pages will start returning 404.** Production currently serves `blog-posts/`,
   `localization` and the data-flow documents. No link in the repository, the extension or the
   published pages points to them, so nothing needs updating, but outside bookmarks will break.
