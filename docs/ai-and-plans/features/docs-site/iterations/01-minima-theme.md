---
feature: docs-site
kind: iteration
status: active
prs: [420]
created: 2025-12-11
---

# Iteration 01: Minima theme for the documentation site

## Goal

Replace the default GitHub Pages look (Primer) with Minima 3, add the customization hooks, and
document how to change the theme.

## What the PR contained (2025-12-11)

- `docs/_config.yml`: `remote_theme: jekyll/minima@1e8a445`, `baseurl`, the whitelisted plugins,
  `minima.skin: auto`, commented examples for navigation and social links.
- `docs/assets/css/style.scss` and `docs/_sass/minima/custom-*.scss`: the Minima 3 override hooks.
- `docs/_includes/custom-head.html` and `sub-footer.html`: commented examples only.
- `docs/THEME_CUSTOMIZATION.md`: a customization guide at the top of `docs/`.
- `.github/workflows/deploy-documentation-preview.yml`: a "Known limitations" note in the preview
  comment (shared `_config.yml`, broken asset links under the production `baseurl`).

The same day, `main` removed PR preview deployments entirely (`c8ad1900`), which left the PR
conflicting.

## 2026-10-16: refresh

- **Merged `main` into the branch.** The only conflict was the preview workflow: modified here,
  deleted on `main`. Resolved by **accepting the deletion**. The note it added described the
  limitations of a workflow that no longer exists. Keeping the workflow was rejected: re-adding
  previews was not the goal of this PR and `main` removed them deliberately.
- **Moved the guide into this feature folder.** `docs/THEME_CUSTOMIZATION.md` was published as a
  page and showed up as "Theme Customization Guide" in the site header. It is contributor
  documentation, so it now lives in [design.md](../design.md). Keeping it at the `docs/` root was
  rejected for that reason.
- **Refreshed the guide against current GitHub Pages.** Findings:
  - The legacy build is still `github-pages` v232 (Jekyll 3.10.0, Minima 2.5.1). Minima 3 still
    needs `remote_theme`.
  - The Actions publishing route is mature (`upload-pages-artifact` v5, `deploy-pages` v5), but
    hosted PR previews (`deploy-pages` `preview: true`) are still alpha and not public.
  - The navigation example used `minima.nav_pages`, which the pinned commit does not read; it
    reads `header_pages`. Recorded as an open gap rather than changing the config in this step.
  - Minima `master` is about 30 functional commits ahead of the pin.
  - The "Testing locally" section put the Gemfile inside `docs/`, which would publish it. The new
    guide keeps it outside and adds a local config that skips `ai-and-plans/`.
- **Verified locally.** Built with `github-pages` 232 on Ruby 3.3 (Windows). With `ai-and-plans/`
  excluded, the build finishes in about 8 seconds and the landing page renders with the Minima
  `auto` skin. A full build including `ai-and-plans/` did not finish within about 8 minutes and
  produced many Liquid syntax warnings.

## Not verified

- The production build on GitHub (legacy Pages) with this theme.
- Rendering of the user manual, release notes and blog posts beyond the landing page.
- Dark skin rendering.
