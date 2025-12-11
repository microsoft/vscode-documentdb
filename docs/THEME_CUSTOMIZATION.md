# Theme Customization Guide

This directory contains customization files for the Minima theme used with GitHub Pages.

## 📁 File Structure

```
docs/
├── _config.yml              # Main Jekyll configuration
├── assets/css/
│   └── style.scss          # Main stylesheet (imports theme + custom overrides)
├── _sass/minima/
│   ├── custom-variables.scss  # Variable overrides (colors, fonts, spacing)
│   └── custom-styles.scss     # CSS style overrides
└── _includes/
    ├── custom-head.html      # Custom <head> content (favicons, fonts, etc.)
    └── sub-footer.html       # Custom content before </body> tag
```

## 🎨 Available Skins

Minima includes several built-in color schemes. Change in `_config.yml`:

- `classic` (default) - Light color scheme
- `dark` - Dark variant
- `auto` - Adaptive (switches based on OS/browser preference)
- `solarized` - Adaptive solarized scheme
- `solarized-light` - Light solarized
- `solarized-dark` - Dark solarized

```yaml
minima:
  skin: classic # Change this value
```

## 🔧 Customization Order

1. **Variables First**: Edit `_sass/minima/custom-variables.scss`
   - Override colors, fonts, spacing BEFORE they're used
   - Cannot override actual CSS styles here

2. **Styles Second**: Edit `_sass/minima/custom-styles.scss`
   - Override CSS styles AFTER base theme is loaded
   - Cannot override Sass variables here

3. **Main Stylesheet**: Edit `assets/css/style.scss`
   - Additional custom CSS/SCSS at the bottom
   - One-off overrides that don't fit elsewhere

## 📝 Common Customizations

### Change Colors

Edit `_sass/minima/custom-variables.scss`:

```scss
$brand-color: #0078d4;
$link-base-color: #0078d4;
$text-color: #333333;
$background-color: #ffffff;
```

### Change Fonts

Edit `_sass/minima/custom-variables.scss`:

```scss
$base-font-family:
  'Inter',
  -apple-system,
  system-ui,
  sans-serif;
$code-font-family: 'Fira Code', 'Consolas', monospace;
```

### Adjust Layout Width

Edit `_sass/minima/custom-variables.scss`:

```scss
$content-width: 1000px;
```

### Custom Navigation

Edit `_config.yml`:

```yaml
minima:
  nav_pages:
    - index.md
    - user-manual.md
    - about.md
```

### Add Social Links

Edit `_config.yml`:

```yaml
minima:
  social_links:
    - title: GitHub Repository
      icon: github
      url: 'https://github.com/microsoft/vscode-documentdb'
```

### Add Favicon

1. Generate favicons at https://realfavicongenerator.net/
2. Add the provided code to `_includes/custom-head.html`

## 🔌 GitHub Pages Plugins

These plugins are enabled in `_config.yml`:

- `jekyll-feed` - Generates RSS/Atom feed
- `jekyll-seo-tag` - SEO optimization
- `jekyll-sitemap` - XML sitemap
- `jekyll-mentions` - GitHub @mentions
- `jekyll-redirect-from` - Page redirects
- `jekyll-avatar` - GitHub avatars
- `jemoji` - Emoji support

See [GitHub Pages dependencies](https://pages.github.com/versions/) for all available plugins.

## 🚀 Testing Locally

1. Install Ruby and Bundler
2. Create a `Gemfile` in the docs folder:

```ruby
source 'https://rubygems.org'

gem 'github-pages', group: :jekyll_plugins
gem 'webrick' # Required for Ruby 3.0+
```

3. Run:

```bash
cd docs
bundle install
bundle exec jekyll serve
```

4. Visit http://localhost:4000

## 📚 Additional Resources

- [Minima Theme Documentation](https://github.com/jekyll/minima)
- [Jekyll Documentation](https://jekyllrb.com/docs/)
- [GitHub Pages Documentation](https://docs.github.com/en/pages)
- [Liquid Template Language](https://shopify.github.io/liquid/)
- [Font Awesome Icons](https://fontawesome.com/search?ic=brands) (for social links)

## ⚠️ Important Notes

- The remote theme is pinned to commit `1e8a445` for stability
- Changes to `_config.yml` require restarting the Jekyll server
- CSS changes are picked up automatically in watch mode
- Front matter (the `---` lines) is required in `assets/css/style.scss`
