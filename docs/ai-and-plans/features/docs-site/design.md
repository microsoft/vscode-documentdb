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
    - docs/_sass/minima/**
    - docs/assets/css/**
---

# Documentation site: theme and customization

> Replaces `docs/THEME_CUSTOMIZATION.md` from PR #420. Refreshed on 2026-10-16 against the current
> GitHub Pages build and Minima. Where this guide and Minima's own README disagree, Minima's README
> **at the pinned commit** wins.

## What GitHub Pages offers today

Checked 2026-10-16.

| Option                            | What you get                                                                                                                  | Used here |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------- |
| Branch publishing, "legacy" build | GitHub builds Jekyll with the `github-pages` gem (v232: Jekyll 3.10.0, Ruby 3.3, safe mode)                                   | Yes       |
| Supported themes                  | Minima 2.5.1 and the `jekyll-theme-*` set (Primer is the default when no theme is set)                                        | No        |
| `remote_theme`                    | Any public GitHub theme repository, at a branch, tag or commit                                                                | Yes       |
| Custom GitHub Actions workflow    | Any generator or plugin, Jekyll 4, Sass modules; deploy with `actions/upload-pages-artifact` v5 and `actions/deploy-pages` v5 | No        |
| Pull request preview sites        | `deploy-pages` has a `preview` input, but it is still alpha and not available to the public                                   | No        |

Consequences for this site:

- Minima 3 features (skins, `custom-variables.scss`, `custom-styles.scss`, `social_links`) are not
  in the supported Minima 2.5.1. They are only reachable through `remote_theme`, which is why the
  config pins a commit of `jekyll/minima`.
- Under the legacy build, only the whitelisted plugins load. The ones in `_config.yml` are all on
  that list.
- Moving to an Actions build would remove the plugin and version limits, but it also changes the
  repository Pages source from `gh-pages` to "GitHub Actions". That is a separate decision.

## Files

```
docs/
├── _config.yml                     # Jekyll configuration, theme pin, Minima options
├── assets/css/style.scss           # Stylesheet entry point; needs the empty front matter
├── _sass/minima/
│   ├── custom-variables.scss       # Sass variable overrides, before the theme
│   └── custom-styles.scss          # CSS overrides, after the theme
└── _includes/
    ├── custom-head.html            # Extra <head> content (favicons, fonts, meta)
    └── sub-footer.html             # Content just before </body>
```

## Theme pin

```yaml
remote_theme: 'jekyll/minima@1e8a445'
```

`1e8a445` is Minima `master` from 2025-02-27. Minima 3.0 has no release yet, so a commit pin is the
only stable option. Minima's README itself warns against tracking `master` HEAD. Before updating the
pin, read the compare view and check the open gaps in [README.md](./README.md#open-gaps), since
config keys changed between commits.

## Skins

Set in `_config.yml`:

```yaml
minima:
    skin: auto
```

| Skin              | Behavior                             |
| ----------------- | ------------------------------------ |
| `classic`         | Light (the default)                  |
| `dark`            | Dark                                 |
| `auto`            | Follows the OS or browser preference |
| `solarized`       | Adaptive Solarized                   |
| `solarized-light` | Light Solarized                      |
| `solarized-dark`  | Dark Solarized                       |

## Where an override goes

1. **Sass variables** go in `_sass/minima/custom-variables.scss`. They are read before the theme
   uses them. CSS rules here do not override anything.
2. **CSS rules** go in `_sass/minima/custom-styles.scss`. They load after the theme. Sass variable
   changes here come too late.
3. **One-off rules** can go at the bottom of `assets/css/style.scss`.

Example variables:

```scss
$brand-color: #0078d4;
$link-base-color: #0078d4;
$content-width: 1000px;
$base-font-family: 'Segoe UI', -apple-system, system-ui, sans-serif;
```

## Header navigation

Without an explicit list, Minima puts **every page that has a `title`** into the header. On this
site that includes the privacy data-flow documents and, in production, all of `ai-and-plans/`.

The key depends on the pinned commit:

| Minima version     | Key                         |
| ------------------ | --------------------------- |
| `1e8a445` (pinned) | `header_pages:` (top level) |
| current `master`   | `minima.nav_pages:`         |

```yaml
# For the pinned 1e8a445
header_pages:
    - blog-posts/index.md
```

Paths are relative to `docs/`. `user-manual/` and `release-notes/` have no index page today, so
they cannot be linked from the header until one is added.

## Social links

```yaml
minima:
    social_links:
        - title: GitHub Repository
          icon: github
          url: 'https://github.com/microsoft/vscode-documentdb'
```

Icons are Font Awesome brand names. Newer Minima `master` pins Font Awesome 7.

## Favicon and head content

Add `<link>` and `<meta>` tags to `_includes/custom-head.html`. Use `relative_url` so the
`/vscode-documentdb` base URL is respected:

```html
<link rel="icon" href="{{ '/assets/favicon.png' | relative_url }}" />
```

## Previewing locally

There are no hosted PR previews, so preview locally with the same gem GitHub uses.

1. Install Ruby with the DevKit (Windows: `winget install RubyInstallerTeam.RubyWithDevKit.3.3`).
2. Keep the Gemfile **outside** `docs/`, so it is not published:

   ```ruby
   source 'https://rubygems.org'
   gem 'github-pages', group: :jekyll_plugins
   gem 'webrick'
   gem 'tzinfo-data'
   gem 'wdm', '>= 0.1.0', platforms: [:windows]
   ```

3. Optionally, add a local-only config that skips the planning documents. A full build with
   `ai-and-plans/` takes many minutes; without it, about 8 seconds:

   ```yaml
   # _config.preview.yml (outside the repository)
   exclude:
       - ai-and-plans
   ```

4. Run from the folder holding the Gemfile:

   ```bash
   bundle install
   bundle exec jekyll serve --source <repo>/docs --destination ./_site \
       --config <repo>/docs/_config.yml,./_config.preview.yml --livereload
   ```

5. Open http://127.0.0.1:4000/vscode-documentdb/ (note the base URL).

Notes:

- Restart the server after changing `_config.yml`. Sass and Markdown changes reload live.
- The first build downloads the remote theme, so it needs network access.
- A `favicon.ico` 404 in the browser console is expected until a favicon is added.

## References

- [GitHub Pages dependency versions](https://pages.github.com/versions/)
- [Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Minima README](https://github.com/jekyll/minima) (read it at the pinned commit)
- [Jekyll documentation](https://jekyllrb.com/docs/)
